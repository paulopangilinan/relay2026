import { createClient } from '@supabase/supabase-js';
import { getAdmin } from '../lib/admin-auth.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';


function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

// Counts seats taken in a session, excluding the speaker's own auto-seated
// row (Round 82) — done as a second, targeted query rather than a `.neq()`
// on the main count query. `.neq('registration_id', x)` translates to SQL
// `registration_id <> x`, and `NULL <> x` evaluates to NULL (not TRUE) in a
// WHERE clause — so once manual participants (registration_id IS NULL,
// Round 103) exist, a plain `.neq()` here would silently drop every one of
// them from the capacity count and let a session overfill. This approach
// counts everyone, then subtracts the speaker's seat only if it's actually
// present, so NULL rows are never filtered out by a comparison that treats
// NULL as neither equal nor unequal.
async function countSeatsTaken(sessionId, speakerRegistrationId) {
  const { count, error } = await supabase
    .from('breakout_selections')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw error;
  let taken = count || 0;
  if (speakerRegistrationId) {
    const { count: speakerSeated, error: spErr } = await supabase
      .from('breakout_selections')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('registration_id', speakerRegistrationId);
    if (spErr) throw spErr;
    taken -= (speakerSeated || 0);
  }
  return taken;
}

async function loadActiveSession(sessionId) {
  const { data: session, error: sessErr } = await supabase
    .from('breakout_sessions')
    .select('id, title, capacity, is_active, speaker_registration_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessErr) throw sessErr;
  return session && session.is_active ? session : null;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const admin = await getAdmin(event, supabase);
  if (!admin) return json(401, { error: 'Unauthorized' });
  if (!admin.permissions?.verify_payment && !admin.is_super_admin) return json(403, { error: 'No permission' });

  try {
    // ── GET: fetch all sessions + all confirmed registrants + their selections ──
    if (event.httpMethod === 'GET') {
      // Fetch all active breakout sessions
      const { data: sessions, error: sessErr } = await supabase
        .from('breakout_sessions')
        .select('id, title, speaker, speaker_post, speaker_registration_id, capacity, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('title', { ascending: true });
      if (sessErr) throw sessErr;

      // Fetch all breakout selections (fallback if selected_by_admin is not yet migrated)
      let selections = [];
      const { data: selData, error: selErr } = await supabase
        .from('breakout_selections')
        .select('id, registration_id, session_id, participant_name, participant_age, participant_church, email, selected_by_admin, assigned_at');
      if (selErr) {
        // Fallback without the new columns if migration hasn't been run yet
        const { data: fallbackData, error: fallbackErr } = await supabase
          .from('breakout_selections')
          .select('id, registration_id, session_id, participant_name, email');
        if (fallbackErr) throw fallbackErr;
        selections = (fallbackData || []).map(s => ({ ...s, selected_by_admin: false }));
      } else {
        selections = selData || [];
      }

      // Fetch all confirmed (non-cancelled) registrations
      const { data: registrations, error: regErr } = await supabase
        .from('registrations')
        .select('id, name, email, mobile, age, church, registrant_type, status, breakout_invited_at')
        .neq('status', 'cancelled')
        .order('name', { ascending: true });
      if (regErr) throw regErr;

      // Build a map of registration_id -> selection. Manual selections
      // (registration_id IS NULL, Round 103) are handled in their own loop
      // below instead — they'd all collide on the same `null` key here
      // (there's no registrant to look one up by), and they're never
      // matched against anything in the registrations-driven loop anyway.
      const selectionMap = {};
      for (const sel of (selections || [])) {
        if (sel.registration_id) selectionMap[sel.registration_id] = sel;
      }

      // Group registrants
      const sessionMap = {};
      for (const s of (sessions || [])) {
        sessionMap[s.id] = { ...s, participants: [] };
      }
      const unassigned = [];

      for (const reg of (registrations || [])) {
        const sel = selectionMap[reg.id];
        const participant = {
          registrationId: reg.id,
          name: reg.name,
          email: reg.email,
          mobile: reg.mobile,
          age: reg.age,
          church: reg.church,
          registrantType: reg.registrant_type,
          sessionId: sel?.session_id || null,
          selfSelected: sel ? !sel.selected_by_admin : null, // null = no selection at all
          assignedAt: sel?.assigned_at || null,
          invitedAt: reg.breakout_invited_at || null,
        };

        if (sel && sessionMap[sel.session_id]) {
          sessionMap[sel.session_id].participants.push(participant);
        } else {
          // Either no selection, or selection is for a session that's now
          // inactive — show in unassigned.
          unassigned.push(participant);
        }
      }

      // Round 103: participants added directly onto a session with no
      // registrations row backing them at all — never surfaced by the
      // registrations-driven loop above, since there's no registrant to
      // iterate. Always admin-assigned (there's no self-selection path for
      // someone with no registration to send a link to). If their session
      // has since gone inactive, they land in Unassigned too rather than
      // vanishing — same fallback the registration-backed rows above get.
      for (const sel of (selections || [])) {
        if (sel.registration_id) continue;
        const participant = {
          registrationId: null,
          selectionId: sel.id,
          isManual: true,
          name: sel.participant_name,
          email: sel.email || null,
          mobile: null,
          age: sel.participant_age ?? null,
          church: sel.participant_church || null,
          registrantType: null,
          sessionId: sel.session_id,
          selfSelected: false,
          assignedAt: sel.assigned_at || null,
          invitedAt: null,
        };
        if (sessionMap[sel.session_id]) {
          sessionMap[sel.session_id].participants.push(participant);
        } else {
          unassigned.push(participant);
        }
      }

      // Round 82: the registrant picked as a session's speaker (set in
      // admin-breakout-sessions.js, which also seats them there — see that
      // file's POST handler) is pinned to the top of that session's list
      // and flagged isSpeaker, computed here at read time rather than
      // stored as a separate column — a session only ever has the one
      // speaker_registration_id, so this is always a single lookup, not a
      // join.
      for (const sess of Object.values(sessionMap)) {
        if (!sess.speaker_registration_id) continue;
        const idx = sess.participants.findIndex(p => p.registrationId === sess.speaker_registration_id);
        if (idx > -1) {
          const [speakerParticipant] = sess.participants.splice(idx, 1);
          speakerParticipant.isSpeaker = true;
          sess.participants.unshift(speakerParticipant);
        }
      }

      return json(200, {
        sessions: Object.values(sessionMap),
        unassigned,
        totalConfirmed: (registrations || []).length,
        totalSelected: (selections || []).length,
      });
    }

    // ── POST: admin adds a participant with no registrations row at all
    //          (Round 103; Round 106 relaxed this to allow landing in
    //          Unassigned with no session yet — the button that triggers
    //          this now only lives on the Unassigned column, and admins
    //          drag from there into whichever session fits). Email is
    //          optional and never queues a breakout invite — being added
    //          here already IS their assignment once (if) they're dropped
    //          onto a session; sitting in Unassigned isn't an assignment
    //          yet, same as any other unassigned participant. ──
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { name, email, age, church, sessionId } = body;

      const cleanName = String(name || '').trim();
      if (!cleanName) return json(400, { error: 'Name is required.' });
      const cleanChurch = String(church || '').trim();
      if (!cleanChurch) return json(400, { error: 'Church is required.' });
      const cleanEmail = String(email || '').trim() || null;
      let cleanAge = null;
      if (age !== undefined && age !== null && String(age).trim() !== '') {
        const parsedAge = parseInt(age, 10);
        if (isNaN(parsedAge) || parsedAge < 0 || parsedAge > 120) {
          return json(400, { error: 'Age must be a valid number.' });
        }
        cleanAge = parsedAge;
      }

      // sessionId is now optional — omit it (or pass null) to land the
      // new participant in Unassigned instead of a specific session.
      if (sessionId) {
        const session = await loadActiveSession(sessionId);
        if (!session) return json(404, { error: 'Session not found' });

        const taken = await countSeatsTaken(sessionId, session.speaker_registration_id);
        if (taken >= session.capacity) {
          return json(409, { error: 'This session is already at capacity.' });
        }
      }

      const now = new Date().toISOString();
      const { data: inserted, error: insErr } = await supabase
        .from('breakout_selections')
        .insert({
          registration_id: null,
          session_id: sessionId || null,
          participant_name: cleanName,
          participant_age: cleanAge,
          participant_church: cleanChurch,
          email: cleanEmail,
          selected_by_admin: !!sessionId,
          assigned_at: sessionId ? now : null,
          updated_at: now,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;

      return json(200, { success: true, selectionId: inserted.id });
    }

    // ── DELETE: permanently remove a manually-added participant (Round
    //           106). Separate from PATCH's sessionId:null, which now
    //           means "move to Unassigned" for a manual participant too
    //           (see below) — this is the only way to actually delete one
    //           once Unassigned became a legitimate resting place for
    //           them. ──
    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { selectionId } = body;
      if (!selectionId) return json(400, { error: 'Missing selectionId' });

      const { data: existing, error: existErr } = await supabase
        .from('breakout_selections')
        .select('id, registration_id')
        .eq('id', selectionId)
        .maybeSingle();
      if (existErr) throw existErr;
      if (!existing || existing.registration_id) {
        return json(404, { error: 'Manual participant not found.' });
      }

      const { error: delErr } = await supabase.from('breakout_selections').delete().eq('id', existing.id);
      if (delErr) throw delErr;
      return json(200, { success: true, removed: true });
    }

    // ── PATCH: admin manually assigns an unassigned participant to a
    //           session, reassigns an admin-assigned participant to a
    //           different session, OR unassigns one back to the pool
    //           (sessionId: null) — self-selected participants are locked
    //           and can never be touched by any of these three.
    //
    //           A manually-added participant (Round 103) is addressed by
    //           selectionId instead of registrationId — they have no
    //           registrations row to look up. Since Round 106, Unassigned
    //           is a real resting place for them too (the "+ Add" button
    //           now only lives on that column), so sessionId: null here
    //           moves them there the same way it does for a real
    //           registrant — it no longer deletes the row. Deleting one
    //           outright is DELETE above, a separate, explicit action. ──
    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const { registrationId, selectionId, sessionId } = body;

      if (!registrationId && !selectionId) {
        return json(400, { error: 'Missing registrationId or selectionId' });
      }
      if (sessionId === undefined) {
        return json(400, { error: 'Missing sessionId' });
      }

      if (selectionId) {
        const { data: existing, error: existErr } = await supabase
          .from('breakout_selections')
          .select('id, session_id, registration_id, participant_name')
          .eq('id', selectionId)
          .maybeSingle();
        if (existErr) throw existErr;
        if (!existing || existing.registration_id) {
          return json(404, { error: 'Manual participant not found.' });
        }

        if (sessionId === null) {
          const { error: updErr } = await supabase
            .from('breakout_selections')
            .update({ session_id: null, assigned_at: null, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          if (updErr) throw updErr;
          return json(200, { success: true });
        }

        const session = await loadActiveSession(sessionId);
        if (!session) return json(404, { error: 'Session not found' });

        const taken = await countSeatsTaken(sessionId, session.speaker_registration_id);
        if (taken >= session.capacity) {
          return json(409, { error: 'This session is already at capacity.' });
        }

        const now = new Date().toISOString();
        const { error: updErr } = await supabase
          .from('breakout_selections')
          .update({ session_id: sessionId, assigned_at: now, updated_at: now })
          .eq('id', existing.id);
        if (updErr) throw updErr;

        return json(200, { success: true });
      }

      // Confirm the participant exists and is not cancelled
      const { data: reg, error: regErr } = await supabase
        .from('registrations')
        .select('id, name, email, status')
        .eq('id', registrationId)
        .maybeSingle();
      if (regErr) throw regErr;
      if (!reg || reg.status === 'cancelled') {
        return json(404, { error: 'Registration not found or cancelled' });
      }

      // Only allow reassignment/unassignment of participants with NO
      // existing self-selection — those who chose their own session are
      // locked and cannot be moved OR unassigned by admins, UNLESS the
      // requesting admin is a super admin (Round 79's hidden override
      // escape hatch). admin.is_super_admin comes from the verified JWT
      // (getAdmin() above) on every request — never a client-supplied
      // flag — so this is a real security boundary, not just a UI
      // convenience; a regular admin hitting this endpoint directly still
      // gets the 409 no matter what the client sends.
      let existing = null;
      const { data: existData, error: existErr } = await supabase
        .from('breakout_selections')
        .select('id, selected_by_admin')
        .eq('registration_id', registrationId)
        .maybeSingle();

      if (existErr) {
        // If column doesn't exist yet, query just by id
        const { data: fallbackExist } = await supabase
          .from('breakout_selections')
          .select('id')
          .eq('registration_id', registrationId)
          .maybeSingle();
        existing = fallbackExist;
      } else {
        existing = existData;
      }

      if (existing && existing.selected_by_admin === false && !admin.is_super_admin) {
        return json(409, { error: 'This participant chose their own session and cannot be reassigned.' });
      }

      // sessionId === null means "unassign" — delete the admin-assigned
      // selection row entirely, sending them back to the Unassigned pool.
      if (sessionId === null) {
        if (!existing) return json(200, { success: true, alreadyUnassigned: true });
        const { error: delErr } = await supabase
          .from('breakout_selections')
          .delete()
          .eq('id', existing.id);
        if (delErr) throw delErr;
        return json(200, { success: true });
      }

      // Confirm target session exists and has capacity
      const session = await loadActiveSession(sessionId);
      if (!session) return json(404, { error: 'Session not found' });

      const taken = await countSeatsTaken(sessionId, session.speaker_registration_id);
      if (taken >= session.capacity) {
        return json(409, { error: 'This session is already at capacity.' });
      }

      const now = new Date().toISOString();

      if (existing) {
        // Update the existing admin-assigned selection to the new session
        const updatePayload = { session_id: sessionId, updated_at: now };
        const { error: updErr } = await supabase
          .from('breakout_selections')
          .update({ ...updatePayload, assigned_at: now })
          .eq('id', existing.id);
        if (updErr) {
          // Fallback if assigned_at column does not exist
          const { error: fallbackUpdErr } = await supabase
            .from('breakout_selections')
            .update(updatePayload)
            .eq('id', existing.id);
          if (fallbackUpdErr) throw fallbackUpdErr;
        }
      } else {
        // Insert a new admin-assigned selection
        const basePayload = {
          registration_id: registrationId,
          session_id: sessionId,
          participant_name: reg.name,
          email: reg.email,
          updated_at: now,
        };
        const { error: insErr } = await supabase
          .from('breakout_selections')
          .insert({
            ...basePayload,
            selected_by_admin: true,
            assigned_at: now,
          });
        if (insErr) {
          // Fallback if selected_by_admin or assigned_at column does not exist
          const { error: fallbackInsErr } = await supabase
            .from('breakout_selections')
            .insert(basePayload);
          if (fallbackInsErr) throw fallbackInsErr;
        }
      }

      return json(200, { success: true });
    }

    return json(405, { error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[admin-breakout-responses]', err);
    return json(500, { error: err.message });
  }
};
