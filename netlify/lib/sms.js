// netlify/lib/sms.js
// SMS delivery via Semaphore (https://semaphore.co) — Philippine mobiles only.
//
// Registrant mobiles are stored as +639XXXXXXXXX by the PH form; international
// registrants carry other country codes and are skipped rather than failed.
//
// Env — BOTH are required. Either one missing makes smsReady() false and every
// send a logged no-op:
//   SEMAPHORE_API_KEY      account key
//   SEMAPHORE_SENDER_NAME  an APPROVED sender name from your Semaphore account
//                          (max 11 alphanumeric chars). PH carriers block
//                          unregistered sender IDs, so there is no usable
//                          default — set this only once Semaphore approves it,
//                          and set it to the approved name exactly.
//
// Semaphore is outbound only — there is no inbound/reply API. Recipients cannot
// reply to these messages, so any call to action must live in the message body.

const MESSAGES_URL = 'https://api.semaphore.co/api/v4/messages';
const ACCOUNT_URL  = 'https://api.semaphore.co/api/v4/account';

export function smsConfigured() {
  return !!process.env.SEMAPHORE_API_KEY;
}

/** The approved sender ID, or null when unset. */
export function smsSenderName() {
  return (process.env.SEMAPHORE_SENDER_NAME || '').trim() || null;
}

/**
 * Master gate for every SMS feature. PH carriers reject messages sent without
 * an approved sender ID, so an API key alone is not enough to send anything —
 * treat "no sender name" as "SMS is not available yet" rather than letting
 * every send fail at the provider.
 */
export function smsReady() {
  return smsConfigured() && !!smsSenderName();
}

/**
 * Normalize a PH mobile to Semaphore's 639XXXXXXXXX form.
 * Accepts +639171234567 / 639171234567 / 09171234567 / 9171234567.
 * Returns null for anything that isn't a PH mobile (incl. international numbers).
 */
export function normalizePHMobile(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  let local = null;
  if      (/^639\d{9}$/.test(digits)) local = digits.slice(2);
  else if (/^09\d{9}$/.test(digits))  local = digits.slice(1);
  else if (/^9\d{9}$/.test(digits))   local = digits;
  return local ? `63${local}` : null;
}

// SMS billing depends on the alphabet used. A message made entirely of GSM-7
// characters fits 160 per segment; a single character outside that set (em
// dash, curly quotes, emoji, ellipsis…) switches the whole message to UCS-2,
// which fits only 70. Getting this wrong understates cost by ~2.3x.
const GSM7 = new Set([...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà']);
const GSM7_EXTENDED = new Set([...'^{}\\[~]|€']);   // these cost 2 characters each

export function analyzeMessage(message) {
  const text = message || '';
  if (!text) return { encoding: 'GSM-7', units: 0, segments: 0, nonGsm: [] };

  let units = 0;
  const nonGsm = [];
  for (const ch of text) {
    if (GSM7.has(ch))               units += 1;
    else if (GSM7_EXTENDED.has(ch)) units += 2;
    else { if (!nonGsm.includes(ch)) nonGsm.push(ch); }
  }

  if (nonGsm.length) {
    // UCS-2: count UTF-16 code units, 70 per single part / 67 when concatenated
    const u = [...text].reduce((n, ch) => n + (ch.codePointAt(0) > 0xFFFF ? 2 : 1), 0);
    return { encoding: 'UCS-2', units: u, segments: u <= 70 ? 1 : Math.ceil(u / 67), nonGsm };
  }
  return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153), nonGsm };
}

export function estimateSegments(message) {
  return analyzeMessage(message).segments;
}

// Semaphore reports validation problems as [{ field: ["human readable reason"] }].
// Pull the sentence out so the dashboard can show why a send failed instead of
// raw JSON — "No active sender name found" is the difference between a two-minute
// fix and an afternoon of guessing.
function describeSemaphoreError(json, status) {
  if (!json) return `HTTP ${status}`;
  const first = Array.isArray(json) ? json[0] : json;
  if (first && typeof first === 'object') {
    const messages = Object.values(first).flat().filter(v => typeof v === 'string');
    if (messages.length) return messages.join(' ').slice(0, 220);
  }
  return JSON.stringify(json).slice(0, 220);
}

/**
 * Send one SMS. Never throws — returns a result the caller can log.
 * @returns {Promise<{sent:boolean, skipped?:string, error?:string, id?:string, number?:string, segments:number}>}
 */
export async function sendSMS({ to, message }) {
  const segments = estimateSegments(message);

  if (!smsConfigured())        return { sent: false, skipped: 'not_configured', segments };
  if (!smsSenderName())        return { sent: false, skipped: 'sender_name_missing', segments };
  if (!message?.trim())        return { sent: false, skipped: 'empty_message', segments };

  const number = normalizePHMobile(to);
  if (!number)                 return { sent: false, skipped: 'not_ph_mobile', segments };

  try {
    const params = new URLSearchParams({
      apikey:  process.env.SEMAPHORE_API_KEY,
      number,
      message,
    });
    params.set('sendername', smsSenderName());

    const res  = await fetch(MESSAGES_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return { sent: false, error: describeSemaphoreError(json, res.status), number, segments };
    }

    const first = Array.isArray(json) ? json[0] : json;
    return {
      sent:     true,
      id:       String(first?.message_id ?? ''),
      status:   first?.status || 'queued',
      number,
      segments,
    };
  } catch (err) {
    return { sent: false, error: err.message, number, segments };
  }
}

/**
 * Registered sender names and their approval status. PH carriers block
 * unregistered sender IDs, so a "Pending" name means nothing can send yet —
 * worth showing in the dashboard rather than leaving admins guessing.
 */
export async function getSenderNames() {
  if (!smsConfigured()) return null;
  try {
    const res = await fetch(`https://api.semaphore.co/api/v4/account/sendernames?apikey=${encodeURIComponent(process.env.SEMAPHORE_API_KEY)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json)
      ? json.map(s => ({ name: s.name, status: s.status, created: s.created }))
      : null;
  } catch {
    return null;
  }
}

/** Account balance / credit info for the Site Settings panel. Null when unavailable. */
export async function getSMSAccount() {
  if (!smsConfigured()) return null;
  try {
    const res = await fetch(`${ACCOUNT_URL}?apikey=${encodeURIComponent(process.env.SEMAPHORE_API_KEY)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const acct = Array.isArray(json) ? json[0] : json;
    return {
      account_name: acct?.account_name ?? null,
      credit_balance: acct?.credit_balance ?? null,
      status: acct?.status ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Text every distinct mobile in a member list, personalised per person.
 * Members sharing a number get one message, not two. Non-PH numbers still go
 * through sendAndLogSMS so the skip is recorded rather than vanishing.
 *
 * Group members each supply their own mobile, so any notification about them
 * has to fan out — reaching only the contact person leaves the rest in the dark.
 * Callers are responsible for filtering the list to the right people first.
 */
export async function sendToDistinctMobiles(supabase, members, { event, groupId, triggeredBy, buildMessage }) {
  const seen = new Set();
  const recipients = [];
  for (const member of members || []) {
    const key = normalizePHMobile(member.mobile) || `raw:${member.mobile || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(member);
  }

  // Sent in parallel: each one is an HTTP round-trip plus a log insert, and
  // doing a five-member group serially inside a bulk run blows the function
  // timeout. sendAndLogSMS never throws, so Promise.all can't reject.
  return Promise.all(recipients.map(member => sendAndLogSMS(supabase, {
    to:             member.mobile,
    message:        buildMessage(member),
    event,
    registrationId: member.id,
    groupId,
    triggeredBy,
  })));
}

/**
 * Fire an SMS and record the attempt in sms_log. Never throws.
 * Logging failures are swallowed — an audit gap must not break a registration.
 */
export async function sendAndLogSMS(supabase, { to, message, event, registrationId, groupId, triggeredBy }) {
  const result = await sendSMS({ to, message });

  try {
    await supabase.from('sms_log').insert({
      registration_id: registrationId || null,
      group_id:        groupId || null,
      event,
      mobile:          result.number || to || null,
      message,
      segments:        result.sent ? result.segments : 0,
      status:          result.sent ? 'sent' : (result.skipped ? 'skipped' : 'failed'),
      detail:          result.sent ? `semaphore:${result.id}` : (result.skipped || result.error || null),
      triggered_by:    triggeredBy || 'system',
    });
  } catch (err) {
    console.error('[sms] could not write sms_log:', err.message);
  }

  if (!result.sent && result.error) console.error(`[sms] ${event} send failed:`, result.error);
  return result;
}
