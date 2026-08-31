import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { sendEmail } from '../lib/mailer.js';
import { formatOrderCode } from '../lib/merch.js';

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
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('merch_preorders').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ orders: data || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const id = body.id;
      const action = body.action;
      if (!id || !action) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id or action' }) };

      if (action === 'mark_paid') {
        const { data: order, error: getErr } = await supabase.from('merch_preorders').select('total_amount, status').eq('id', id).maybeSingle();
        if (getErr) throw getErr;
        if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
        if (order.status === 'cancelled') return { statusCode: 400, headers, body: JSON.stringify({ error: 'This order is cancelled' }) };
        const { error } = await supabase.from('merch_preorders')
          .update({ payment_status: 'paid', deposit_amount: order.total_amount })
          .eq('id', id);
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (action === 'add_partial') {
        const amount = Number.parseInt(body.amount, 10);
        if (!Number.isFinite(amount) || amount <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Enter a valid payment amount' }) };
        const { data: order, error: getErr } = await supabase.from('merch_preorders').select('total_amount, deposit_amount, status').eq('id', id).maybeSingle();
        if (getErr) throw getErr;
        if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
        if (order.status === 'cancelled') return { statusCode: 400, headers, body: JSON.stringify({ error: 'This order is cancelled' }) };
        const newDeposit = Math.min(Number(order.total_amount || 0), Number(order.deposit_amount || 0) + amount);
        const newPaymentStatus = newDeposit >= Number(order.total_amount || 0) ? 'paid' : 'partial';
        const { error } = await supabase.from('merch_preorders')
          .update({ deposit_amount: newDeposit, payment_status: newPaymentStatus })
          .eq('id', id);
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, deposit_amount: newDeposit, payment_status: newPaymentStatus }) };
      }

      if (action === 'complete') {
        const { data: order, error: fetchErr } = await supabase.from('merch_preorders').select('*').eq('id', id).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
        if (order.status === 'cancelled') return { statusCode: 400, headers, body: JSON.stringify({ error: 'This order is cancelled' }) };

        const { error } = await supabase.from('merch_preorders').update({ status: 'completed' }).eq('id', id);
        if (error) throw error;

        // Best-effort — a slow/broken mail provider shouldn't stop the
        // admin from completing the order.
        try {
          await sendOrderCompletedEmail(order);
        } catch (e) {
          console.error('[admin-merch-orders] complete email failed:', e.message);
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (action === 'cancel') {
        // Cancelling an order cancels its payment too — there's nothing left
        // to collect or mark paid on a cancelled order.
        const { error } = await supabase.from('merch_preorders')
          .update({ status: 'cancelled', payment_status: 'cancelled' })
          .eq('id', id);
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('[admin-merch-orders]', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function sendOrderCompletedEmail(order) {
  if (!order.email) return;

  const imgUrl  = (process.env.IMAGE_SITE_URL || process.env.SITE_URL || '').replace(/\/+$/, '');
  const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;
  const firstName = String(order.participant_name || '').trim().split(/\s+/)[0] || 'there';
  const orderCode = formatOrderCode(order.order_number);

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(it =>
    `<tr><td style="padding:8px 10px;border-bottom:1px solid #EDF2F5;">${escapeHtml(it.name)}${it.size ? ' · ' + escapeHtml(it.size) : ''}</td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #EDF2F5;text-align:center;">${it.quantity}</td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #EDF2F5;text-align:right;">PHP ${Number((it.price || 0) * it.quantity).toLocaleString()}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#2E7048);padding:24px 28px;text-align:center;}
    .header h1{color:#fff;font-size:20px;margin:0;}
    .body{padding:28px;}
    .note{background:#EAF5EE;border-left:3px solid #2E7048;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#1F5233;line-height:1.6;margin:18px 0;}
    .footer{background:#f7fafb;padding:16px 28px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>Your Merch Preorder is Complete \u2713</h1>${orderCode ? `<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:6px;letter-spacing:0.04em;">Order ${escapeHtml(orderCode)}</div>` : ''}</div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:14px;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
      <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:16px;">
        Good news — your RELAY 2026 merch preorder is complete. Here's your order summary:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#2A3D4A;margin-bottom:14px;">
        <thead><tr style="background:#F7FAFB;"><th style="padding:8px 10px;text-align:left;">Item</th><th style="padding:8px 10px;">Qty</th><th style="padding:8px 10px;text-align:right;">Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="font-size:14px;color:#2A3D4A;margin:0 0 4px;">Total amount: <strong>PHP ${Number(order.total_amount || 0).toLocaleString()}</strong></p>
      <div class="note">Please pick up your order at the RELAY 2026 venue. Bring a valid ID and be ready to settle any remaining balance on-site.</div>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;

  await sendEmail({
    to: order.email,
    subject: 'Your RELAY 2026 Merch Preorder is Complete',
    html,
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
