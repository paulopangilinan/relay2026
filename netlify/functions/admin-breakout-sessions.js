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

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const admin = getAdmin(event);
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
        .select('session_id');
      if (countErr) throw countErr;

      const tally = {};
      for (const row of counts || []) tally[row.session_id] = (tally[row.session_id] || 0) + 1;

      return json(200, { sessions: (sessions || []).map(s => toClient(s, tally[s.id] || 0)) });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const session = normalizeSession(body.session || body);
      const id = body.id || body.session?.id || null;

      if (id) {
        const { data, error } = await supabase
          .from('breakout_sessions')
          .update(session)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return json(200, { success: true, session: toClient(data, 0) });
      }

      const { data, error } = await supabase
        .from('breakout_sessions')
        .insert(session)
        .select()
        .single();
      if (error) throw error;
      return json(200, { success: true, session: toClient(data, 0) });
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

  const capacity = Math.max(1, Number.parseInt(raw.capacity, 10) || 45);
  const sortOrder = Number.parseInt(raw.sortOrder ?? raw.sort_order, 10) || 0;

  return {
    title,
    speaker,
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
