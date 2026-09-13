import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const admin = getAdmin(event);
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
        .select('registration_id, session_id, participant_name, email, selected_by_admin, assigned_at');
      if (selErr) {
        // Fallback without the new columns if migration hasn't been run yet
        const { data: fallbackData, error: fallbackErr } = await supabase
          .from('breakout_selections')
          .select('registration_id, session_id, participant_name, email');
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

      // Build a map of registration_id -> selection
      const selectionMap = {};
      for (const sel of (selections || [])) {
        selectionMap[sel.registration_id] = sel;
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
        totalSelected: Object.keys(selectionMap).length,
      });
    }

    // ── PATCH: admin manually assigns an unassigned participant to a
    //           session, reassigns an admin-assigned participant to a
    //           different session, OR unassigns one back to the pool
    //           (sessionId: null) — self-selected participants are locked
    //           and can never be touched by any of these three. ──
    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const { registrationId, sessionId } = body;

      if (!registrationId) {
        return json(400, { error: 'Missing registrationId' });
      }

      if (sessionId === undefined) {
        return json(400, { error: 'Missing sessionId' });
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
      const { data: session, error: sessErr } = await supabase
        .from('breakout_sessions')
        .select('id, capacity, is_active, speaker_registration_id')
        .eq('id', sessionId)
        .maybeSingle();
      if (sessErr) throw sessErr;
      if (!session || !session.is_active) return json(404, { error: 'Session not found' });

      // Speakers don't count against attendee capacity (Round 82) — the
      // speaker's own seat (auto-assigned in admin-breakout-sessions.js) is
      // excluded from this count so it never fills the room for real
      // attendees.
      let countQuery = supabase
        .from('breakout_selections')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId);
      if (session.speaker_registration_id) {
        countQuery = countQuery.neq('registration_id', session.speaker_registration_id);
      }
      const { count, error: countErr } = await countQuery;
      if (countErr) throw countErr;
      if ((count || 0) >= session.capacity) {
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
