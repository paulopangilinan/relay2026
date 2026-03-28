// netlify/functions/churches.js
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers    = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || 'relay2026secret';

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  // ── GET: public ─────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { all } = event.queryStringParameters || {};

    // Fetch groups
    let groupQuery = supabase.from('church_groups').select('*').order('name');
    if (!all) groupQuery = groupQuery.eq('is_archived', false);
    const { data: groups, error: ge } = await groupQuery;
    if (ge) return { statusCode: 500, headers, body: JSON.stringify({ error: ge.message }) };

    // Fetch churches with group join
    let churchQuery = supabase
      .from('churches')
      .select('id, name, group_id, is_archived, created_at, church_groups(id, name)')
      .order('name');
    if (!all) churchQuery = churchQuery.eq('is_archived', false);
    const { data: churchRows, error: ce } = await churchQuery;
    if (ce) return { statusCode: 500, headers, body: JSON.stringify({ error: ce.message }) };

    // Normalize: add group_name from join for convenience
    const churches = (churchRows || []).map(c => ({
      ...c,
      group_name: c.church_groups?.name || '',
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ churches, groups: groups || [] }) };
  }

  // All write ops require manage_churches
  const admin = getAdmin(event);
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!admin.permissions?.manage_churches) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to manage churches' }) };
  }

  const body   = JSON.parse(event.body || '{}');
  const entity = body.entity || 'church';

  // ── POST: add ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      if (entity === 'group') {
        const { name } = body;
        if (!name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Group name required' }) };
        const { data, error } = await supabase.from('church_groups').insert({ name: name.trim() }).select().single();
        if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, group: data }) };
      } else {
        const { name, group_id } = body;
        if (!name || !group_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and group required' }) };
        const { data, error } = await supabase.from('churches').insert({ name: name.trim(), group_id }).select().single();
        if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, church: data }) };
      }
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── PUT: edit or archive ─────────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name, group_id, is_archived } = body;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ID required' }) };
      const table   = entity === 'group' ? 'church_groups' : 'churches';
      const updates = {};
      if (name        !== undefined) updates.name        = name.trim();
      if (group_id    !== undefined) updates.group_id    = group_id;
      if (is_archived !== undefined) updates.is_archived = is_archived;
      const { error } = await supabase.from(table).update(updates).eq('id', id);
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
