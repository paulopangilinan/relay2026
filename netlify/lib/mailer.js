// netlify/lib/mailer.js
// Central mail sender.
//
// Gmail (nodemailer) remains the default provider and behaves exactly as it did
// before this module existed. Resend is opt-in per send — pass provider:'resend'.
// If Resend is requested but unconfigured or failing, the send falls back to
// Gmail so a mail never silently disappears.

import nodemailer from 'nodemailer';

const FROM_NAME = 'RELAY 2026';

let cachedTransporter = null;

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return cachedTransporter;
}

// Both are required. With a key but no verified from-address, Resend rejects
// every send and we fall back to Gmail — so offering it in the dropdown would
// just be a slower path to the same result.
export function resendConfigured() {
  return !!process.env.RESEND_API_KEY && !!(process.env.RESEND_FROM || '').trim();
}

// RESEND_FROM must be an address on a domain verified in Resend. No GMAIL_USER
// fallback — gmail.com isn't a domain you can verify there, so falling back to
// it would guarantee a rejection.
// Accepts either "relay@example.com" or "RELAY 2026 <relay@example.com>".
function resendFrom() {
  const addr = (process.env.RESEND_FROM || '').trim();
  return addr.includes('<') ? addr : `${FROM_NAME} <${addr}>`;
}

async function sendViaGmail({ to, subject, html, replyTo }) {
  const info = await getTransporter().sendMail({
    from: `"${FROM_NAME}" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
  return { provider: 'gmail', id: info.messageId };
}

async function sendViaResend({ to, subject, html, replyTo }) {
  // The templates tell registrants to "reply to this email". Resend sends from
  // the verified domain, which nobody watches — so point replies at CONTACT_EMAIL
  // (the same address the public pages advertise), falling back to the Gmail inbox.
  const replyAddress = replyTo || process.env.CONTACT_EMAIL || process.env.GMAIL_USER;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom(),
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyAddress ? { reply_to: replyAddress } : {}),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || json?.error?.message || `HTTP ${res.status}`);
  return { provider: 'resend', id: json.id };
}

/**
 * Send one email.
 * @param {object}  opts
 * @param {string|string[]} opts.to
 * @param {string}  opts.subject
 * @param {string}  opts.html
 * @param {string} [opts.replyTo]
 * @param {'gmail'|'resend'} [opts.provider='gmail']
 * @returns {Promise<{provider:string,id:string,fellBack?:boolean}>}
 */
export async function sendEmail({ to, subject, html, replyTo, provider }) {
  if (provider === 'resend') {
    if (!resendConfigured()) {
      console.warn('[mailer] Resend requested but RESEND_API_KEY is unset — using Gmail.');
      return { ...(await sendViaGmail({ to, subject, html, replyTo })), fellBack: true };
    }
    try {
      return await sendViaResend({ to, subject, html, replyTo });
    } catch (err) {
      console.error('[mailer] Resend send failed, falling back to Gmail:', err.message);
      return { ...(await sendViaGmail({ to, subject, html, replyTo })), fellBack: true };
    }
  }
  return sendViaGmail({ to, subject, html, replyTo });
}

// 'gmail' | 'resend' — anything else is coerced to the Gmail default.
export function normalizeProvider(value) {
  return value === 'resend' ? 'resend' : 'gmail';
}
