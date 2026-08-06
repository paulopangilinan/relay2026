// netlify/functions/confirm-attendance.js
// Landing point for the CTA buttons in the pre-conference invitation email.
//
//   GET  ?t=<jwt>&r=attending|not_attending  -> shows a confirmation page
//   POST t, r (form-encoded)                 -> records the answer
//
// The GET deliberately does NOT write. Corporate mail scanners (Defender Safe
// Links, Proofpoint, Barracuda) fetch every URL in a message to check it, and
// this email carries both the accept and decline links — so a scanner would
// record an answer nobody gave, with a real timestamp, and whichever link it
// fetched last would win. Scanners don't submit forms, so the write lives
// behind a POST.
//
// The link is a signed token rather than a bare registration id: this endpoint
// writes on someone's behalf, so a guessable URL would let anyone mark
// arbitrary people as attending.

import { createClient } from '@supabase/supabase-js';
import { readAttendanceToken, ATTENDANCE_RESPONSES } from '../lib/attendance.js';
import { escapeHtml } from '../lib/html.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const VALID    = new Set(ATTENDANCE_RESPONSES);

const LABEL = {
  attending:     'attending',
  not_attending: 'not attending',
};

export const handler = async (event) => {
  const method = event.httpMethod;
  const params = method === 'POST' ? parseBody(event) : (event.queryStringParameters || {});
  const { t, r } = params;

  if (!t || !VALID.has(r)) {
    return page('Link Incomplete', 'This link is missing part of its confirmation code. Please use the buttons in the email we sent you.', false);
  }

  const rid = readAttendanceToken(t);
  if (!rid) {
    return page('Link Expired', 'This confirmation link is no longer valid. Please contact us and we will send a fresh one.', false);
  }

  try {
    const { data: reg } = await supabase
      .from('registrations')
      .select('id, name, status, attendance_response')
      .eq('id', rid)
      .maybeSingle();

    if (!reg) return page('Not Found', 'We could not find that registration.', false);
    if (reg.status === 'cancelled') {
      return page('Registration Cancelled', 'This registration has been cancelled, so attendance cannot be recorded. Please contact us if this is unexpected.', false);
    }

    const firstName = escapeHtml(String(reg.name || '').trim().split(/\s+/)[0] || 'there');

    // GET: ask, don't act.
    if (method !== 'POST') return confirmPage(firstName, t, r, reg.attendance_response);

    const changed = reg.attendance_response && reg.attendance_response !== r;
    const { error } = await supabase.from('registrations').update({
      attendance_response:     r,
      attendance_responded_at: new Date().toISOString(),
    }).eq('id', rid);
    if (error) throw error;

    if (r === 'attending') {
      return page(
        changed ? 'Answer Updated' : "You're all set!",
        `Thanks ${firstName} — we've got you down for the <strong>Aspiring Leader Pre-Conference Sessions</strong> on <strong>Tuesday, September 23</strong>, 2:00 PM to 6:00 PM at CCT Tagaytay. See you there!`,
        true
      );
    }
    return page(
      changed ? 'Answer Updated' : 'Thanks for letting us know',
      `Thanks ${firstName} — we've noted that you won't be joining the Aspiring Leader Pre-Conference Sessions. Your conference registration is unaffected. If your plans change, use the other button in your email.`,
      true
    );
  } catch (err) {
    console.error('[confirm-attendance]', err);
    return page('Something Went Wrong', 'We could not record your answer just now. Please try again in a moment.', false);
  }
};

// Netlify hands POST bodies through as a string, base64-encoded for some content types.
function parseBody(event) {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    return Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return {};
  }
}

const SHELL = (title, inner) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html' },
  body: `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'DM Sans',Arial,sans-serif;background:#F2F5F8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
    .card{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:460px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.1);}
    .icon{font-size:52px;margin-bottom:16px;}
    h1{font-family:'Bebas Neue';font-size:28px;color:#1C2B38;margin-bottom:12px;letter-spacing:0.04em;}
    p{font-size:14px;color:#6B8A9A;line-height:1.7;}
    .badge{display:inline-block;color:#fff;border-radius:8px;padding:10px 24px;font-family:'Bebas Neue';font-size:18px;letter-spacing:0.06em;margin-top:24px;}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);border-radius:16px 16px 0 0;margin:-48px -40px 32px;width:calc(100% + 80px);}
    .btn{display:inline-block;width:100%;padding:15px 20px;border:none;border-radius:8px;font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:600;cursor:pointer;margin-top:20px;}
    .btn-yes{background:#2E7048;color:#fff;}
    .btn-no{background:#6B8A9A;color:#fff;}
    .alt{display:inline-block;margin-top:16px;font-size:13px;color:#6B8A9A;}
  </style></head>
  <body><div class="card"><div class="bar"></div>${inner}</div></body></html>`,
});

// Step one: confirm the choice. Nothing is written until this form is submitted.
function confirmPage(firstName, token, response, existing) {
  const yes  = response === 'attending';
  const other = yes ? 'not_attending' : 'attending';
  const already = existing
    ? `<p style="margin-top:10px;">You previously told us you were <strong>${escapeHtml(LABEL[existing])}</strong>. Submitting this will update your answer.</p>`
    : '';

  return SHELL(yes ? 'Confirm your spot' : 'Confirm you cannot make it', `
    <div class="icon">${yes ? '🎟️' : '🗓'}</div>
    <h1>${yes ? 'See you there?' : 'Cannot make it?'}</h1>
    <p>Hi ${firstName}, please confirm that you <strong>${yes ? 'will be joining' : 'will not be joining'}</strong>
       the Aspiring Leader Pre-Conference Sessions on Tuesday, September 23.</p>
    ${already}
    <form method="POST">
      <input type="hidden" name="t" value="${escapeHtml(token)}">
      <input type="hidden" name="r" value="${escapeHtml(response)}">
      <button type="submit" class="btn ${yes ? 'btn-yes' : 'btn-no'}">
        ${yes ? "Yes, I'll be there" : "Confirm I can't make it"}
      </button>
    </form>
    <a class="alt" href="?t=${encodeURIComponent(token)}&r=${other}">
      ${yes ? "Actually, I can't make it" : "Actually, I can make it"}
    </a>`);
}

function page(title, message, success) {
  return SHELL(title, `
    <div class="icon">${success ? '✅' : '❌'}</div>
    <h1>${escapeHtml(title)}</h1><p>${message}</p>
    <div class="badge" style="background:${success ? '#2E7048' : '#C0392B'};">RELAY 2026</div>`);
}
