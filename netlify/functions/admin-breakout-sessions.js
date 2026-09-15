import { createClient } from '@supabase/supabase-js';
import { getAdmin } from '../lib/admin-auth.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';


export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const admin = await getAdmin(event, supabase);
  if (!admin) return json(401, { error: 'Unauthorized' });
  if (!admin.permissions?.verify_payment && !admin.is_super_admin) return json(403, { error: 'No permission' });

  try {
    if (event.httpMethod === 'GET') {
      const { data: sessions, error } = await supabase
        .from('breakout_sessions')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('title', { ascending: true });
      if (error) throw error;

      const { data: counts, error: countErr } = await supabase
        .from('breakout_selections')
        .select('session_id, registration_id');
      if (countErr) throw countErr;

      // Speakers don't count against attendee capacity (Round 82) — the
      // selectedCount shown in this Settings list should read as "seats
      // taken by attendees", not include the session's own auto-seated
      // speaker.
      const speakerIdBySession = {};
      for (const s of sessions || []) {
        if (s.speaker_registration_id) speakerIdBySession[s.id] = s.speaker_registration_id;
      }
      const tally = {};
      for (const row of counts || []) {
        if (speakerIdBySession[row.session_id] === row.registration_id) continue;
        tally[row.session_id] = (tally[row.session_id] || 0) + 1;
      }

      return json(200, { sessions: (sessions || []).map(s => toClient(s, tally[s.id] || 0)) });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const session = normalizeSession(body.session || body);
      const id = body.id || body.session?.id || null;

      let savedSession;
      if (id) {
        const { data, error } = await supabase
          .from('breakout_sessions')
          .update(session)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        savedSession = data;
      } else {
        const { data, error } = await supabase
          .from('breakout_sessions')
          .insert(session)
          .select()
          .single();
        if (error) throw error;
        savedSession = data;
      }

      // Round 82: picking a session's speaker also seats them in that same
      // session, in one step — this is now the *only* way a speaker gets
      // marked, replacing the old manual "Mark as Speaker" exclude toggle
      // (retired: every registrant ends up in a session one way or
      // another — admin-assigned, self-elected, or seated here). Being
      // pinned to the top of the list and badged "Speaker" is computed at
      // read time in admin-breakout-responses.js by comparing
      // registration_id to this session's speaker_registration_id — no
      // extra flag needed on breakout_selections itself.
      //
      // Upsert (not insert) because breakout_selections.registration_id is
      // UNIQUE — this moves them here from wherever they previously were
      // (another session, self-selected or admin-assigned) in one call,
      // and deliberately isn't subject to the target session's capacity
      // check normal reassignments go through: a session's speaker has to
      // be seatable in their own session regardless of how full it already
      // is with attendees.
      if (savedSession.speaker_registration_id) {
        const { data: speakerReg, error: regErr } = await supabase
          .from('registrations')
          .select('id, name, email, status')
          .eq('id', savedSession.speaker_registration_id)
          .maybeSingle();
        if (regErr) throw regErr;
        if (speakerReg && speakerReg.status !== 'cancelled') {
          const now = new Date().toISOString();
          const basePayload = {
            registration_id: speakerReg.id,
            session_id: savedSession.id,
            participant_name: speakerReg.name,
            email: speakerReg.email,
            updated_at: now,
          };
          const { error: upsertErr } = await supabase
            .from('breakout_selections')
            .upsert({ ...basePayload, selected_by_admin: true, assigned_at: now }, { onConflict: 'registration_id' });
          if (upsertErr) {
            // Fallback if selected_by_admin/assigned_at columns don't exist yet
            const { error: fallbackErr } = await supabase
              .from('breakout_selections')
              .upsert(basePayload, { onConflict: 'registration_id' });
            if (fallbackErr) throw fallbackErr;
          }
        }
      }

      return json(200, { success: true, session: toClient(savedSession, 0) });
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return json(400, { error: 'Missing session id' });
      // A session with existing selections isn't deleted outright — that
      // would silently orphan participants' picks. Deactivate it instead so
      // it stops appearing to new pickers but selection history is intact.
      const { count, error: countErr } = await supabase
        .from('breakout_selections')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', id);
      if (countErr) throw countErr;
      if ((count || 0) > 0) {
        const { error } = await supabase.from('breakout_sessions').update({ is_active: false }).eq('id', id);
        if (error) throw error;
        return json(200, { success: true, deactivated: true });
      }
      const { error } = await supabase.from('breakout_sessions').delete().eq('id', id);
      if (error) throw error;
      return json(200, { success: true });
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('[admin-breakout-sessions]', err);
    return json(500, { error: err.message });
  }
};

function normalizeSession(raw) {
  const title = String(raw.title || '').trim();
  if (!title) throw new Error('Session title is required');
  const speaker = String(raw.speaker || '').trim();
  if (!speaker) throw new Error('Speaker name is required');
  // Round 81: speaker is now picked from an existing registrant in the
  // admin UI rather than typed freely — this is the FK backing that pick.
  // Still nullable at the DB layer (see migration comment), but the client
  // is expected to always send one now; kept optional here rather than
  // throwing so an old/cached client payload without it doesn't hard-fail.
  const speakerRegistrationId = String(raw.speakerRegistrationId ?? raw.speaker_registration_id ?? '').trim() || null;

  const capacity = Math.max(1, Number.parseInt(raw.capacity, 10) || 45);
  const sortOrder = Number.parseInt(raw.sortOrder ?? raw.sort_order, 10) || 0;

  return {
    title,
    speaker,
    speaker_registration_id: speakerRegistrationId,
    speaker_post: String(raw.speakerPost ?? raw.speaker_post ?? '').trim() || null,
    capacity,
    is_active: raw.isActive ?? raw.is_active ?? true,
    sort_order: sortOrder,
  };
}

function toClient(s, selectedCount) {
  return {
    id: s.id,
    title: s.title,
    speaker: s.speaker,
    speakerRegistrationId: s.speaker_registration_id || null,
    speakerPost: s.speaker_post || '',
    capacity: s.capacity,
    isActive: !!s.is_active,
    sortOrder: s.sort_order || 0,
    selectedCount,
    createdAt: s.created_at,
  };
}

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}
