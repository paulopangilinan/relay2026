// netlify/lib/mailer.js
// Central mail sender.
//
// Resend is now the default provider repo-wide. Gmail (nodemailer) is opt-in
// per send — pass provider:'gmail' — and remains the fallback: if Resend is
// requested (explicitly or by default) but unconfigured or failing, the send
// falls back to Gmail so a mail never silently disappears.
//
// Gmail sends (whether requested directly or reached via fallback) are
// throttled to reduce the odds of the account getting flagged/blocked for
// bulk/automated sending — see GMAIL_THROTTLE_MS below. This matters most
// when Resend's own limit (lower than Gmail's) is exhausted and everything
// starts falling back to Gmail at once.

import nodemailer from 'nodemailer';

const FROM_NAME = 'RELAY 2026';

let cachedTransporter = null;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Gmail's abuse detection responds far more to send *velocity* (many sends
// in quick succession from one account) than Resend's does — spacing sends
// out is one of the few concrete things the fallback path can do to look
// less like automated/bulk sending. This only holds within a single warm
// function instance (module-level state resets on cold start), but that
// still covers the common case: several Gathering admin-notify emails going
// out back-to-back in one request when Resend's quota has been exhausted
// and every one of them falls back to Gmail together.
const GMAIL_THROTTLE_MS = 700;
let lastGmailSendAt = 0;
async function throttleGmail() {
  const wait = GMAIL_THROTTLE_MS - (Date.now() - lastGmailSendAt);
  if (wait > 0) await sleep(wait);
  lastGmailSendAt = Date.now();
}

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
  await throttleGmail();
  const info = await getTransporter().sendMail({
    from: `"${FROM_NAME}" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
  // nodemailer's sendMail() promise resolves successfully even when the SMTP
  // server rejected specific recipients — it only throws on a hard failure
  // of the transaction itself. A rejected recipient shows up in
  // info.rejected (and is absent from info.accepted) while the call still
  // "succeeds", which is exactly how a blocked/bounced send was silently
  // getting marked as invited: no exception ever reached the caller's catch
  // block. Treat any rejected recipient as a real failure instead.
  const targets = Array.isArray(to) ? to : [to];
  const rejected = (info.rejected || []).filter(addr => targets.includes(addr));
  if (rejected.length) {
    const reason = (info.rejectedErrors && info.rejectedErrors[0]?.message) || 'Rejected by mail server';
    throw new Error(`Gmail rejected ${rejected.join(', ')}: ${reason}`);
  }
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
  if (provider === 'gmail') {
    return sendViaGmail({ to, subject, html, replyTo });
  }
  // Default (provider unset or 'resend'): try Resend, fall back to Gmail.
  if (!resendConfigured()) {
    console.warn('[mailer] Resend is the default provider but RESEND_API_KEY/RESEND_FROM are unset — using Gmail.');
    return { ...(await sendViaGmail({ to, subject, html, replyTo })), fellBack: true };
  }
  try {
    return await sendViaResend({ to, subject, html, replyTo });
  } catch (err) {
    console.error('[mailer] Resend send failed, falling back to Gmail:', err.message);
    return { ...(await sendViaGmail({ to, subject, html, replyTo })), fellBack: true };
  }
}

// 'gmail' | 'resend' — anything else is coerced to the Resend default.
export function normalizeProvider(value) {
  return value === 'gmail' ? 'gmail' : 'resend';
}
