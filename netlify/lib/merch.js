import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET || 'relay2026secret';
const SCOPE = 'merch_preorder';

export function merchToken(registrationId) {
  return jwt.sign({ rid: registrationId, scope: SCOPE }, SECRET(), { expiresIn: '120d' });
}

export function readMerchToken(token) {
  try {
    const decoded = jwt.verify(token, SECRET());
    if (decoded?.scope !== SCOPE || !decoded?.rid) return null;
    return decoded.rid;
  } catch {
    return null;
  }
}

export function merchLink(siteUrl, registrationId) {
  const base = `${(siteUrl || '').replace(/\/+$/, '')}/merch-preorder.html`;
  return `${base}?t=${encodeURIComponent(merchToken(registrationId))}`;
}

// Human-friendly sequential order code shown to admins and participants
// instead of the raw UUID primary key, e.g. RLY-00001.
export function formatOrderCode(orderNumber) {
  const n = Number.parseInt(orderNumber, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return 'RLY-' + String(n).padStart(5, '0');
}
