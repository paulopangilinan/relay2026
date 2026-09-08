import jwt from 'jsonwebtoken';
 
const SECRET = () => process.env.JWT_SECRET || 'relay2026secret';
const SCOPE = 'breakout_selection';
 
export function breakoutToken(registrationId) {
  return jwt.sign({ rid: registrationId, scope: SCOPE }, SECRET(), { expiresIn: '120d' });
}
 
export function readBreakoutToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET());
    if (decoded?.scope !== SCOPE || !decoded?.rid) return null;
    return decoded.rid;
  } catch {
    return null;
  }
}
 
export function breakoutLink(siteUrl, registrationId) {
  const base = `${(siteUrl || '').replace(/\/+$/, '')}/breakout-selection.html`;
  return `${base}?t=${encodeURIComponent(breakoutToken(registrationId))}`;
}
 
// The submission deadline, in Asia/Manila local time (inclusive). Reads from
// BREAKOUT_SUBMISSION_DUE_DATE (format: YYYY-MM-DD) so it can be updated per
// event cycle without a code change — falls back to the hardcoded default
// if the env var is unset or malformed.
export const BREAKOUT_DUE_DATE = /^\d{4}-\d{2}-\d{2}$/.test(process.env.BREAKOUT_SUBMISSION_DUE_DATE || '')
  ? process.env.BREAKOUT_SUBMISSION_DUE_DATE
  : '2026-09-20';
 
// Mirrors merchFollowupUrgency's shape/logic — computes how the follow-up
// reminder should read *today*, so re-sending it any day automatically
// shifts from "X days left" to "tomorrow" to "today" without anyone editing
// copy by hand.
export function breakoutFollowupUrgency(now = new Date()) {
  const manilaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now); // YYYY-MM-DD
  const daysLeft = Math.round(
    (new Date(`${BREAKOUT_DUE_DATE}T00:00:00Z`) - new Date(`${manilaToday}T00:00:00Z`)) / 86400000
  );
 
  if (daysLeft <= 0) {
    return {
      subjectSuffix: 'today is the LAST DAY to pick your RELAY 2026 breakout session!',
      headline: '⏳ Session selection closes today!',
      sub: "This is it — today's your last chance to choose your breakout session before seats fill up.",
      reminderLine: "Just a friendly reminder — you haven't selected your RELAY 2026 breakout session yet, and today's your very last chance! 🏃",
      cta: 'Pick Your Session — Today Only!',
    };
  }
  if (daysLeft === 1) {
    return {
      subjectSuffix: 'last call — pick your RELAY 2026 breakout session by tomorrow!',
      headline: '⏳ Last day to choose is tomorrow!',
      sub: "Don't miss out — take a moment to lock in the session that fits you best before the window closes.",
      reminderLine: "Just a friendly reminder — you haven't selected your RELAY 2026 breakout session yet, and this is your last chance before the window closes! 🏃",
      cta: 'Pick Your Session — Ends Tomorrow',
    };
  }
  return {
    subjectSuffix: `${daysLeft} days left to pick your RELAY 2026 breakout session!`,
    headline: `⏳ ${daysLeft} days left to choose!`,
    sub: "Don't wait too long — take a moment to lock in the session that fits you best.",
    reminderLine: "Just a friendly reminder — you haven't selected your RELAY 2026 breakout session yet. Pick the topic that fits you best before seats run out! 🏃",
    cta: `Pick Your Session — ${daysLeft} Days Left`,
  };
}