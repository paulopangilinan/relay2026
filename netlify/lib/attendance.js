// netlify/lib/attendance.js
// Signed links for the pre-conference attendance CTA.
//
// The confirm endpoint writes an answer on someone's behalf, so the link must
// not be guessable — a bare registration id in the URL would let anyone mark
// arbitrary people as attending or declining. Tokens are minted only when the
// invitation is sent.

import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET || 'relay2026secret';
const SCOPE  = 'attendance';

export const ATTENDANCE_RESPONSES = ['attending', 'not_attending'];

export function attendanceToken(registrationId) {
  return jwt.sign({ rid: registrationId, scope: SCOPE }, SECRET(), { expiresIn: '120d' });
}

/** Registration id from a token, or null when missing/expired/wrong scope. */
export function readAttendanceToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET());
    if (decoded?.scope !== SCOPE || !decoded?.rid) return null;
    return decoded.rid;
  } catch {
    return null;
  }
}

/** The two CTA URLs for one registration. */
export function attendanceLinks(siteUrl, registrationId) {
  const base  = `${(siteUrl || '').replace(/\/+$/, '')}/.netlify/functions/confirm-attendance`;
  const token = encodeURIComponent(attendanceToken(registrationId));
  return {
    attending:     `${base}?t=${token}&r=attending`,
    not_attending: `${base}?t=${token}&r=not_attending`,
  };
}
