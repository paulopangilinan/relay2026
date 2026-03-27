// netlify/functions/churches.js
// GET    → list all churches (public, for form dropdown — active only)
// POST   → add church (manage_churches permission)
// PUT    → edit church name/group or toggle archive (manage_churches permission)

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

  // ── GET: public — return active churches grouped ─────────────────────────
  if (event.httpMethod === 'GET') {
    const { all } = event.queryStringParameters || {};
    let query = supabase.from('churches').select('*').order('group_name').order('name');
    if (!all) query = query.eq('is_archived', false);
    const { data, error } = await query;
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify({ churches: data }) };
  }

  // All write operations require manage_churches permission
  const admin = getAdmin(event);
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!admin.permissions?.manage_churches) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to manage churches' }) };
  }

  // ── POST: add church ─────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const { name, group_name } = JSON.parse(event.body);
      if (!name || !group_name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and group required' }) };
      const { data, error } = await supabase.from('churches').insert({ name: name.trim(), group_name: group_name.trim() }).select().single();
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, church: data }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── PUT: edit or archive/unarchive ───────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name, group_name, is_archived } = JSON.parse(event.body);
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ID required' }) };
      const updates = {};
      if (name      !== undefined) updates.name       = name.trim();
      if (group_name !== undefined) updates.group_name = group_name.trim();
      if (is_archived !== undefined) updates.is_archived = is_archived;
      const { error } = await supabase.from('churches').update(updates).eq('id', id);
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
