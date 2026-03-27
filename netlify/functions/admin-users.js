// netlify/functions/admin-users.js
// GET    → list all admins (manage_admins only)
// POST   → add admin (manage_admins only)
// PUT    → update admin (manage_admins only)
// DELETE → remove admin (manage_admins only, cannot remove super admin)

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers    = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const requester = getAdmin(event);
  if (!requester) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!requester.permissions?.manage_admins) return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to manage admins' }) };

  // GET — list admins
  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('admins')
      .select('id, email, name, permissions, is_super_admin, force_password_change, created_at')
      .order('created_at');
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify({ admins: data }) };
  }

  // POST — add admin
  if (event.httpMethod === 'POST') {
    try {
      const { email, name, permissions, is_super_admin } = JSON.parse(event.body);
      if (!email || !name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and name required' }) };

      // Only super admins can create other super admins
      const makeSuperAdmin = is_super_admin && requester.is_super_admin;

      const defaultPassword = generatePassword();
      const hash = await bcrypt.hash(defaultPassword, 10);

      const { data: newAdmin, error: insertErr } = await supabase.from('admins').insert({
        email: email.toLowerCase().trim(),
        name,
        password_hash: hash,
        permissions: permissions || { receive_updates: true, verify_payment: false, manage_admins: false },
        is_super_admin: makeSuperAdmin || false,
        force_password_change: true,
      }).select().single();

      if (insertErr) return { statusCode: 400, headers, body: JSON.stringify({ error: insertErr.message }) };

      // Send welcome email — non-blocking so timeout doesn't fail the invite
      const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
      getTransporter().sendMail({
        from:    "RELAY 2026 <noreply@relay2026.org>",
          replyTo: process.env.CONTACT_EMAIL || process.env.GMAIL_USER,
        to:      email,
        subject: 'RELAY 2026 — Your Admin Access',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f7fafb;border-radius:12px;">
            <h2 style="color:#1C2B38;margin-bottom:8px;">Welcome, ${name}!</h2>
            <p style="color:#6B8A9A;font-size:14px;margin-bottom:24px;">You've been added as an admin for the RELAY 2026 registration system.</p>
            <a href="${siteUrl}/admin" style="display:inline-block;padding:12px 24px;background:#1C2B38;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:24px;">Go to Admin Dashboard →</a>
            <div style="background:#fff;border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid #D4E2EA;">
              <div style="font-size:12px;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Login Email</div>
              <div style="font-size:15px;font-weight:700;color:#2A3D4A;">${email}</div>
              <div style="font-size:12px;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;margin-top:14px;margin-bottom:4px;">Temporary Password</div>
              <div style="font-size:18px;font-weight:700;color:#3A8BBF;letter-spacing:0.1em;font-family:monospace;">${defaultPassword}</div>
            </div>
            <p style="color:#6B8A9A;font-size:13px;">⚠️ You'll be asked to change this password on your first login.</p>
          </div>`,
      }).catch(err => console.error('Welcome email failed:', err.message));

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: newAdmin.id }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // PUT — update permissions / name
  if (event.httpMethod === 'PUT') {
    try {
      const { id, name, permissions, is_super_admin } = JSON.parse(event.body);
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ID required' }) };

      // Fetch target admin
      const { data: target } = await supabase.from('admins').select('*').eq('id', id).single();
      if (!target) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Admin not found' }) };

      // Only super admin can change super admin status
      const updates = { name, permissions };
      if (requester.is_super_admin) updates.is_super_admin = is_super_admin || false;

      const { error } = await supabase.from('admins').update(updates).eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // DELETE — remove admin
  if (event.httpMethod === 'DELETE') {
    try {
      const { id } = JSON.parse(event.body);
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ID required' }) };

      const { data: target } = await supabase.from('admins').select('*').eq('id', id).single();
      if (!target) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Admin not found' }) };
      if (target.is_super_admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Cannot remove a super admin' }) };

      const { error } = await supabase.from('admins').delete().eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
