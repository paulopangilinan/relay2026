// netlify/functions/admin-login.js
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers  = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { email, password } = JSON.parse(event.body);
    if (!email || !password) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing credentials' }) };

    const { data: admin, error } = await supabase
      .from('admins')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password' }) };

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name, permissions: admin.permissions, is_super_admin: admin.is_super_admin },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        token,
        force_password_change: admin.force_password_change,
        name: admin.name,
        permissions: admin.permissions,
        is_super_admin: admin.is_super_admin,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
