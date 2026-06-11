// netlify/functions/site-settings.js
// GET → return current settings (public)
// PUT → update settings (super admin only)

import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers    = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('site_settings')
      .select('reg_ph_closed, reg_intl_closed')
      .eq('id', true)
      .single();
    if (error) return { statusCode: 200, headers, body: JSON.stringify({ reg_ph_closed: false, reg_intl_closed: false }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  }

  if (event.httpMethod === 'PUT') {
    const requester = getAdmin(event);
    if (!requester)            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!requester.is_super_admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Super admin only' }) };

    try {
      const { reg_ph_closed, reg_intl_closed } = JSON.parse(event.body);
      const { error } = await supabase
        .from('site_settings')
        .upsert({ id: true, reg_ph_closed: !!reg_ph_closed, reg_intl_closed: !!reg_intl_closed, updated_at: new Date().toISOString() });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
