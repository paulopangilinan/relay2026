// netlify/functions/admin-data.js
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
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

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

async function getAdminsWithPermission(permission) {
  const { data } = await supabase.from('admins').select('email, name, permissions, force_password_change');
  return (data || []).filter(a => a.permissions?.[permission] && !a.force_password_change);
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const requester = getAdmin(event);
  if (!requester) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  // ── GET: fetch all registrations ──────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const { data, error } = await supabase.from('registrations').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      const { data: adminsData } = await supabase.from('admins').select('email, name, force_password_change');

      const local = data.filter(r => r.registrant_type !== 'international');
      const intl  = data.filter(r => r.registrant_type === 'international');

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          local, international: intl,
          stats_local: statsFor(local),
          stats_intl:  statsFor(intl),
          admins: adminsData || [],
          admin: { name: requester.name, permissions: requester.permissions, is_super_admin: requester.is_super_admin },
        }),
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST: actions ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { action, id } = body;

      if (!action || !id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action or id' }) };

      // ── Confirm payment ────────────────────────────────────────────────────
      if (action === 'confirm') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to verify payment' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };

        // Always derive group from DB — never trust client-supplied group_id
        const { scope } = body;
        const effectiveGroupId = scope === 'individual' ? null : (reg.group_id || null);

        const confirmUpdate = {
          payment_verified: true,
          status: 'confirmed',
          verified_at: new Date().toISOString(),
          verified_by: requester.email,
        };
        if (effectiveGroupId) {
          // Never confirm already-cancelled participants — they were removed individually
          await supabase.from('registrations').update(confirmUpdate)
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled');
        } else {
          await supabase.from('registrations').update(confirmUpdate).eq('id', id);
        }

        let allMembers = [reg];
        if (effectiveGroupId) {
          // Only include non-cancelled members in the confirmation email
          const { data: members } = await supabase.from('registrations').select('*')
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled');
          if (members?.length) allMembers = members;
        }

        const isGroup  = allMembers.length > 1;
        const totalAmt = allMembers.reduce((s, r) => s + feeFor(r), 0);
        const imgUrl   = (process.env.IMAGE_SITE_URL || (process.env.SITE_URL || '')).replace(/\/+$/, '');
        const heroUrl  = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;

        await getTransporter().sendMail({
          from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
          to:      reg.email,
          subject: "RELAY 2026 — You're confirmed! 🎉",
          html:    confirmationEmail(reg, allMembers, `PHP ${totalAmt.toLocaleString()}`, heroUrl, isGroup),
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ── Cancel registration ────────────────────────────────────────────────
      if (action === 'cancel') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to cancel registrations' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };

        const { notify, reason, scope } = body;
        // Always derive group from DB — never trust client-supplied group_id
        const effectiveCancelGroupId = scope === 'individual' ? null : (reg.group_id || null);

        const cancelUpdate = {
          status: 'cancelled',
          payment_verified: false,
          cancelled_by: requester.email,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason || null,
        };
        if (effectiveCancelGroupId) {
          // Never cancel already-confirmed participants — they paid individually
          await supabase.from('registrations').update(cancelUpdate)
            .eq('group_id', effectiveCancelGroupId)
            .neq('status', 'confirmed');
        } else {
          await supabase.from('registrations').update(cancelUpdate).eq('id', id);
        }

        if (notify) {
          let allMembers = [reg];
          if (effectiveCancelGroupId) {
            // Only include members that were actually cancelled (exclude confirmed ones)
            const { data: members } = await supabase.from('registrations').select('*')
              .eq('group_id', effectiveCancelGroupId)
              .neq('status', 'confirmed');
            if (members?.length) allMembers = members;
          }
          const imgUrl  = (process.env.IMAGE_SITE_URL || (process.env.SITE_URL || '')).replace(/\/+$/, '');
          const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;
          const names   = allMembers.map(m => m.name).join(', ');
          await getTransporter().sendMail({
            from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
            to:      reg.email,
            subject: 'RELAY 2026 — Registration Cancelled',
            html: cancellationEmail(reg.name, names, allMembers.length > 1, heroUrl),
          });
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ── Follow-up payment reminder ─────────────────────────────────────────
      if (action === 'follow_up') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };
        if (reg.status !== 'awaiting_payment') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Registration is not awaiting payment' }) };
        }

        const effectiveGroupId = reg.group_id || null;
        let allMembers = [reg];
        if (effectiveGroupId) {
          // Only include members who still need to pay — skip confirmed and cancelled
          const { data: members } = await supabase.from('registrations').select('*')
            .eq('group_id', effectiveGroupId)
            .neq('status', 'confirmed')
            .neq('status', 'cancelled');
          if (members?.length) allMembers = members;
        }

        const isGroup    = allMembers.length > 1;
        const totalAmt   = allMembers.reduce((s, r) => s + feeFor(r), 0);
        const totalLabel = `PHP ${totalAmt.toLocaleString()}`;
        const siteUrl    = (process.env.SITE_URL || '').replace(/\/+$/, '');
        const imgUrl     = (process.env.IMAGE_SITE_URL || siteUrl).replace(/\/+$/, '');
        const heroUrl    = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;
        const qrUrl      = `${imgUrl}/assets/images/qr/gcash-qr-email.jpg?v=${Date.now()}`;

        await getTransporter().sendMail({
          from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
          to:      reg.email,
          subject: 'RELAY 2026 — Payment Reminder',
          html:    paymentReminderEmail({
            primaryName: reg.name, totalLabel, qrUrl, heroUrl, siteUrl, imgUrl,
            registrationId: reg.id, group_id: effectiveGroupId, isGroup, allMembers,
            gcashAccountName:   process.env.GCASH_ACCOUNT_NAME,
            gcashAccountHolder: process.env.GCASH_ACCOUNT_HOLDER,
            gcashMobile:        process.env.GCASH_MOBILE,
          }),
        });

        const followupTs = new Date().toISOString();
        if (effectiveGroupId) {
          // Only stamp the timestamp on members who still owe payment
          await supabase.from('registrations').update({ last_followup_at: followupTs })
            .eq('group_id', effectiveGroupId)
            .neq('status', 'confirmed')
            .neq('status', 'cancelled');
        } else {
          await supabase.from('registrations').update({ last_followup_at: followupTs }).eq('id', id);
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ── Record partial payment ─────────────────────────────────────────────
      if (action === 'partial_payment') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const { date, amount, payment_method, notes } = body;
        if (!date || !amount || amount <= 0 || !payment_method) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };
        if (reg.status === 'confirmed' || reg.status === 'cancelled') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot add partial payment to this registration' }) };
        }

        const effectiveGroupId = reg.group_id || null;
        let allMembers = [reg];
        if (effectiveGroupId) {
          // Only count members who still owe — exclude confirmed (already paid) and cancelled
          const { data: members } = await supabase.from('registrations').select('*')
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled')
            .neq('status', 'confirmed');
          if (members?.length) allMembers = members;
        }

        const totalFee        = allMembers.reduce((s, r) => s + feeFor(r), 0);
        const newPartialTotal = (reg.partial_paid_total || 0) + amount;
        const remaining       = totalFee - newPartialTotal;

        await supabase.from('partial_payments').insert({
          registration_id: id,
          group_id: effectiveGroupId,
          date,
          amount,
          payment_method,
          notes: notes || null,
          recorded_by: requester.email,
        });

        const partialUpdate = { partial_paid_total: newPartialTotal, status: 'partially_paid' };
        if (effectiveGroupId) {
          // Only update members who still owe — never revert a confirmed or cancelled status
          await supabase.from('registrations').update(partialUpdate)
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled')
            .neq('status', 'confirmed');
        } else {
          await supabase.from('registrations').update(partialUpdate).eq('id', id);
        }

        const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
        const imgUrl  = (process.env.IMAGE_SITE_URL || siteUrl).replace(/\/+$/, '');
        const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;

        await getTransporter().sendMail({
          from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
          to:      reg.email,
          subject: 'RELAY 2026 — Partial Payment Received',
          html:    partialPaymentEmail({
            primaryName: reg.name, amount, date, payment_method,
            totalFee, newPartialTotal, remaining,
            isGroup: allMembers.length > 1, heroUrl, siteUrl,
            registrationId: reg.id, group_id: effectiveGroupId,
          }),
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    } catch (err) {
      console.error(err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};

function feeFor(r) {
  if (r.registrant_type === 'international') return 250;
  return r.student_status === 'student' ? 3000 : 4500;
}

function statsFor(subset) {
  subset = subset || [];
  const active        = subset.filter(r => r.status !== 'cancelled');
  const confirmed     = subset.filter(r => r.status === 'confirmed');
  const pendingReview = subset.filter(r => r.status === 'payment_pending_review');
  const awaitingPay   = subset.filter(r => r.status === 'awaiting_payment');
  const partiallyPaid = subset.filter(r => r.status === 'partially_paid');
  const cancelled     = subset.filter(r => r.status === 'cancelled');
  // Deduplicate groups for partial_revenue to avoid counting the same payment per member
  const seenGroups = new Set();
  const partial_revenue = partiallyPaid.reduce((sum, r) => {
    if (r.group_id) { if (seenGroups.has(r.group_id)) return sum; seenGroups.add(r.group_id); }
    return sum + (r.partial_paid_total || 0);
  }, 0);
  return {
    total:             active.length,
    confirmed:         confirmed.length,
    pending_review:    pendingReview.length,
    awaiting_payment:  awaitingPay.length,
    partially_paid:    partiallyPaid.length,
    cancelled:         cancelled.length,
    confirmed_revenue: confirmed.reduce((s, r) => s + feeFor(r), 0),
    pending_revenue:   pendingReview.reduce((s, r) => s + feeFor(r), 0),
    awaiting_revenue:  awaitingPay.reduce((s, r) => s + feeFor(r), 0),
    partial_revenue,
    students:          active.filter(r => r.student_status === 'student').length,
    non_students:      active.filter(r => r.student_status === 'non-student').length,
    by_country:        active.reduce((acc, r) => { if (r.country) acc[r.country] = (acc[r.country]||0)+1; return acc; }, {}),
    by_church:         active.reduce((acc, r) => { if (r.church) acc[r.church] = (acc[r.church]||0)+1; return acc; }, {}),
  };
}

function cancellationEmail(primaryName, names, isGroup, heroUrl) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#C0392B);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>Registration Cancelled</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:16px;">Hi <strong>${primaryName}</strong>,</p>
      <p style="font-size:14px;color:#2A3D4A;line-height:1.7;">Your${isGroup ? ' group' : ''} registration for RELAY 2026 has been cancelled${isGroup ? ` (${names})` : ''}. If you believe this is a mistake or would like to re-register, please reach out to us.</p>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}

function paymentReminderEmail({ primaryName, totalLabel, qrUrl, heroUrl, siteUrl, imgUrl, registrationId, group_id, isGroup, allMembers, gcashAccountName, gcashAccountHolder, gcashMobile }) {
  const uploadLink = `${siteUrl}/upload-receipt?id=${registrationId}${isGroup && group_id ? `&group_id=${group_id}` : ''}`;
  const breakdownRows = allMembers.map(m => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;">${m.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;text-align:center;">${m.student_status === 'student' ? 'Student' : 'Non-Student'}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#2A3D4A;text-align:right;">${m.student_status === 'student' ? 'PHP 3,000' : 'PHP 4,500'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#3A8BBF);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .note{background:#FDF6E0;border-left:3px solid #E8B830;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#7A5A10;line-height:1.6;margin:16px 0;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>Payment Reminder</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:16px;">Hi <strong>${primaryName}</strong>,</p>
      <p style="font-size:14px;color:#2A3D4A;margin-bottom:20px;">Just a friendly reminder — your slot${isGroup ? 's are' : ' is'} still pending payment. To confirm your registration, please send <strong>${totalLabel}</strong> via GCash and submit your receipt.</p>
      ${isGroup ? `
        <div style="margin-bottom:4px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;">Registered Participants (${allMembers.length})</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin:12px 0 20px;">
          <thead><tr style="background:#f7fafb;">
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:left;letter-spacing:0.08em;">Participant</th>
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:center;letter-spacing:0.08em;">Type</th>
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:right;letter-spacing:0.08em;">Amount</th>
          </tr></thead>
          <tbody>${breakdownRows}</tbody>
          <tfoot><tr style="background:#f7fafb;border-top:2px solid #D4E2EA;">
            <td colspan="2" style="padding:10px 12px;font-size:13px;font-weight:700;color:#2A3D4A;">Total</td>
            <td style="padding:10px 12px;font-size:14px;font-weight:700;color:#2E7048;text-align:right;">${totalLabel}</td>
          </tr></tfoot>
        </table>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
        <tr><td align="center">
          <table cellpadding="0" cellspacing="0" border="0" style="background:#0A8FD9;border-radius:16px;overflow:hidden;width:100%;max-width:360px;">
            <tr><td style="padding:0;line-height:0;">
              <img src="${imgUrl}/assets/images/gcash-header-email.jpg?v=${Date.now()}" alt="GCash" width="360" style="display:block;width:100%;height:auto;">
            </td></tr>
            <tr><td style="padding:0 14px 14px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F7FA;border-radius:14px;padding:24px 20px;text-align:center;">
                <tr><td align="center" style="padding-bottom:16px;">
                  <img src="${qrUrl}" alt="GCash QR" width="190" height="190" style="display:block;border-radius:10px;border:1px solid #e0e0e0;background:#fff;">
                </td></tr>
                <tr><td style="font-size:13px;color:#666;padding-bottom:14px;">Transfer fees may apply.</td></tr>
                <tr><td style="border-top:1px solid #E0E0E0;padding-top:14px;">
                  <div style="font-size:22px;font-weight:800;color:#0070E0;margin-bottom:4px;">${gcashAccountName || 'CCSGM'}</div>
                  <div style="font-size:14px;font-weight:600;color:#333;margin-bottom:8px;">${gcashAccountHolder || ''}</div>
                  <div style="font-size:13px;padding:4px 0;">
                    <span style="color:#888;">Mobile No.: </span>
                    <span style="color:#444;font-weight:600;font-family:monospace;">${gcashMobile || ''}</span>
                  </div>
                  <div style="margin-top:14px;background:#E8F4FF;border-radius:8px;padding:10px 14px;font-size:13px;color:#0070E0;">
                    💡 <strong>Send Money</strong> in GCash using the mobile number above
                  </div>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
      </table>
      <div class="note">After paying, click the button below to submit your GCash receipt screenshot.</div>
      <div style="text-align:center;margin-top:20px;">
        <a href="${uploadLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:linear-gradient(135deg,#C49A1A,#E8B830);">📎 Submit Payment Receipt</a>
      </div>
      <p style="font-size:11px;color:#6B8A9A;text-align:center;margin-top:10px;">Or copy this link: ${uploadLink}</p>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · CCT Tagaytay · Sept 23–26, 2026</div>
  </div></body></html>`;
}

function partialPaymentEmail({ primaryName, amount, date, payment_method, totalFee, newPartialTotal, remaining, isGroup, heroUrl, siteUrl, registrationId, group_id }) {
  const uploadLink  = `${siteUrl}/upload-receipt?id=${registrationId}${isGroup && group_id ? `&group_id=${group_id}` : ''}`;
  const methodLabel = payment_method === 'gcash' ? 'GCash' : 'Cash';
  const paidPct     = Math.min(100, Math.round((newPartialTotal / totalFee) * 100));
  const [yr, mo, dy] = date.split('-');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateLabel = `${months[parseInt(mo,10)-1]} ${parseInt(dy,10)}, ${yr}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#6D28D9);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .note{background:#EDE9FE;border-left:3px solid #6D28D9;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#4C1D95;line-height:1.6;margin:16px 0;}
    .note-green{background:#EAF5EE;border-left:3px solid #2E7048;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#2E7048;line-height:1.6;margin:16px 0;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>Partial Payment Received 💰</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${primaryName}</strong>, we've received your partial payment. Here's a summary:</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin-bottom:20px;">
        <thead><tr style="background:#f7fafb;"><th colspan="2" style="padding:10px 14px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;text-align:left;border-bottom:1px solid #D4E2EA;">Payment Details</th></tr></thead>
        <tbody>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Amount Paid</td><td style="padding:10px 14px;font-size:14px;font-weight:700;color:#6D28D9;border-bottom:1px solid #D4E2EA;">PHP ${amount.toLocaleString()}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Date</td><td style="padding:10px 14px;font-size:13px;color:#2A3D4A;border-bottom:1px solid #D4E2EA;">${dateLabel}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Method</td><td style="padding:10px 14px;font-size:13px;color:#2A3D4A;border-bottom:1px solid #D4E2EA;">${methodLabel}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Total Paid So Far</td><td style="padding:10px 14px;font-size:13px;font-weight:600;color:#2A3D4A;border-bottom:1px solid #D4E2EA;">PHP ${newPartialTotal.toLocaleString()} of PHP ${totalFee.toLocaleString()}</td></tr>
          <tr style="background:#f7fafb;"><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#2A3D4A;">Remaining Balance</td><td style="padding:10px 14px;font-size:14px;font-weight:700;color:${remaining <= 0 ? '#2E7048' : '#C0392B'};">${remaining <= 0 ? '✅ Fully Paid' : 'PHP ' + remaining.toLocaleString()}</td></tr>
        </tbody>
      </table>
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#6B8A9A;margin-bottom:6px;"><span>Payment Progress</span><span>${paidPct}%</span></div>
        <div style="background:#EDE9FE;border-radius:50px;height:8px;overflow:hidden;"><div style="width:${paidPct}%;height:8px;background:linear-gradient(90deg,#6D28D9,#8B5CF6);border-radius:50px;"></div></div>
      </div>
      ${remaining > 0
        ? `<div class="note">You still have a remaining balance of <strong>PHP ${remaining.toLocaleString()}</strong>. Please complete your payment as soon as possible to secure your slot.<br><br><a href="${uploadLink}" style="display:inline-block;margin-top:8px;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;color:#fff;background:#6D28D9;">📎 Submit Next Payment Receipt</a></div>`
        : `<div class="note-green">Your payment is now complete! Our team will verify and confirm your registration shortly.</div>`}
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · CCT Tagaytay · Sept 23–26, 2026</div>
  </div></body></html>`;
}

function confirmationEmail(primaryReg, allMembers, totalLabel, heroUrl, isGroup) {
  const breakdownRows = allMembers.map(m => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;">${m.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;text-align:center;">${m.student_status === 'student' ? 'Student' : 'Non-Student'}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#2A3D4A;text-align:right;">${m.student_status === 'student' ? 'PHP 3,000' : 'PHP 4,500'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#2E7048);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .highlight{background:#EAF5EE;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px;}
    .highlight h2{color:#2E7048;font-size:20px;margin:0 0 4px;}
    .highlight p{color:#4BAE6A;font-size:13px;margin:0;}
    hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
    .info-box{background:#EBF5FB;border-radius:10px;padding:16px 20px;font-size:13px;color:#2A3D4A;line-height:1.8;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>${isGroup ? 'Your group is confirmed! 🎉' : "You're confirmed! 🎉"}</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${primaryReg.name}</strong>, your payment has been verified and ${isGroup ? 'all participants are' : 'your registration is'} confirmed!</p>
      <div class="highlight"><h2>Registration Confirmed ✅</h2><p>${isGroup ? `${allMembers.length} participants · Slots reserved` : 'Your slot is reserved for RELAY 2026'}</p></div>
      <div style="margin-bottom:4px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;">Church</div>
      <div style="font-size:14px;color:#2A3D4A;margin-bottom:16px;">${primaryReg.church}</div>
      ${isGroup ? `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin-bottom:16px;">
          <thead><tr style="background:#f7fafb;">
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:left;">Participant</th>
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:center;">Type</th>
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:right;">Amount</th>
          </tr></thead>
          <tbody>${breakdownRows}</tbody>
          <tfoot><tr style="background:#f7fafb;border-top:2px solid #D4E2EA;">
            <td colspan="2" style="padding:10px 12px;font-size:13px;font-weight:700;color:#2A3D4A;">Total Paid</td>
            <td style="padding:10px 12px;font-size:14px;font-weight:700;color:#2E7048;text-align:right;">${totalLabel}</td>
          </tr></tfoot>
        </table>` : `
        <div style="margin-bottom:4px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;">Amount Paid</div>
        <div style="font-size:14px;color:#2A3D4A;margin-bottom:16px;">${totalLabel}</div>`}
      <hr>
      <div class="info-box">
        <strong>📍 Location:</strong> CCT Tagaytay Retreat and Training Center<br>
        <strong>🗓 Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br>
        <strong>✝️ Theme:</strong> Living for Christ Alone
      </div>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}
