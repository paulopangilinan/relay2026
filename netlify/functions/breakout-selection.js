import { createClient } from '@supabase/supabase-js';
import { readBreakoutToken, BREAKOUT_DUE_DATE } from '../lib/breakout.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

// Manila-local "today" vs the due date, inclusive of the due date itself.
function isPastDueDate() {
  const manilaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  return manilaToday > BREAKOUT_DUE_DATE;
}

async function sessionsWithAvailability(currentSelectionSessionId = null) {
  const { data: sessions, error } = await supabase
    .from('breakout_sessions')
    .select('id, title, speaker, speaker_post, capacity, speaker_registration_id')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  const { data: counts, error: countErr } = await supabase
    .from('breakout_selections')
    .select('session_id, registration_id');
  if (countErr) throw countErr;

  // Speakers don't count against attendee capacity (Round 82) — a
  // session's speaker is auto-seated there (admin-breakout-sessions.js)
  // but isn't taking an audience seat, so their row is excluded from the
  // tally rather than filling up the room for real self-selecting
  // registrants.
  const speakerIdBySession = {};
  for (const s of sessions || []) {
    if (s.speaker_registration_id) speakerIdBySession[s.id] = s.speaker_registration_id;
  }

  const tally = {};
  for (const row of counts || []) {
    if (speakerIdBySession[row.session_id] === row.registration_id) continue;
    tally[row.session_id] = (tally[row.session_id] || 0) + 1;
  }

  return (sessions || []).map(s => {
    const taken = tally[s.id] || 0;
    // A participant who already holds a seat in this exact session doesn't
    // count against themselves when re-rendering — otherwise a full session
    // would show as unselectable to the very person sitting in it.
    const effectiveTaken = s.id === currentSelectionSessionId ? Math.max(0, taken - 1) : taken;
    const seatsLeft = Math.max(0, s.capacity - effectiveTaken);
    return {
      id: s.id,
      title: s.title,
      speaker: s.speaker,
      speaker_post: s.speaker_post || null,
      capacity: s.capacity,
      seatsLeft,
      isFull: seatsLeft <= 0 && s.id !== currentSelectionSessionId,
    };
  });
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  try {
    const isDev = process.env.ALLOW_MERCH_DEV === 'true' || String(event.headers.host || '').includes('localhost');

    if (event.httpMethod === 'GET') {
      const token = event.queryStringParameters?.t || '';
      const isPreview = event.queryStringParameters?.preview === '1' || (!token && isDev);
      if (isPreview) {
        return json(200, {
          registration: { name: 'Preview Attendee' },
          sessions: await sessionsWithAvailability(),
          currentSelection: null,
          dueDate: BREAKOUT_DUE_DATE,
          closed: false,
          preview: true,
        });
      }

      const devReg = event.queryStringParameters?.dev_reg || null;
      const registrationId = (isDev && devReg) ? devReg : readBreakoutToken(token);
      if (!registrationId) return json(401, { error: 'Invalid or expired link' });

      const { data: reg, error } = await supabase
        .from('registrations')
        .select('id, name, email, status')
        .eq('id', registrationId)
        .maybeSingle();
      if (error) throw error;
      if (!reg || reg.status === 'cancelled') {
        return json(403, { error: 'This breakout session link is not available for cancelled registrations' });
      }

      const { data: existing, error: selErr } = await supabase
        .from('breakout_selections')
        .select('session_id')
        .eq('registration_id', registrationId)
        .maybeSingle();
      if (selErr) throw selErr;

      const sessions = await sessionsWithAvailability(existing?.session_id || null);

      return json(200, {
        registration: reg,
        sessions,
        currentSelection: existing?.session_id || null,
        dueDate: BREAKOUT_DUE_DATE,
        closed: isPastDueDate(),
      });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const devReg = (isDev && body.dev_reg) ? body.dev_reg : null;
      const registrationId = devReg || readBreakoutToken(body.token || '');
      if (!registrationId) return json(401, { error: 'Invalid or expired link' });

      const sessionId = body.session_id;
      if (!sessionId) return json(400, { error: 'Missing session_id' });

      if (isPastDueDate() && !isDev) {
        return json(403, { closed: true, error: 'Breakout session selection is closed' });
      }

      const { data: reg, error: regErr } = await supabase
        .from('registrations')
        .select('id, name, email, status')
        .eq('id', registrationId)
        .maybeSingle();
      if (regErr) throw regErr;
      if (!reg || reg.status === 'cancelled') {
        return json(403, { error: 'This breakout session link is not available for cancelled registrations' });
      }

      const { data: session, error: sessErr } = await supabase
        .from('breakout_sessions')
        .select('id, capacity, is_active, speaker_registration_id')
        .eq('id', sessionId)
        .maybeSingle();
      if (sessErr) throw sessErr;
      if (!session || !session.is_active) return json(404, { error: 'Session not found' });

      const { data: existing, error: existErr } = await supabase
        .from('breakout_selections')
        .select('id, session_id')
        .eq('registration_id', registrationId)
        .maybeSingle();
      if (existErr) throw existErr;

      // Selections are final — once a participant has picked a session,
      // there's no changing it. Reject outright rather than silently no-op
      // or update, so the frontend's lock screen is backed by a real rule.
      if (existing) {
        return json(409, { error: 'You\u2019ve already picked a breakout session — it can\u2019t be changed.', session_id: existing.session_id, already_selected: true });
      }

      // Capacity check: count current holders of the target session,
      // excluding the session's own speaker (Round 82 — a speaker's
      // auto-assigned seat doesn't count against attendee capacity).
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
        return json(409, { error: 'This session just filled up — please pick another.' });
      }

      const row = {
        registration_id: registrationId,
        session_id: sessionId,
        participant_name: reg.name,
        email: reg.email,
        updated_at: new Date().toISOString(),
      };

      const { error: insErr } = await supabase.from('breakout_selections').insert(row);
      if (insErr) throw insErr;

      return json(200, { success: true, session_id: sessionId });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[breakout-selection]', err);
    return json(500, { error: err.message });
  }
};
