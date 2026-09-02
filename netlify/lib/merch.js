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

// Approximate PHP conversion, keyed by the exact country values used in
// register-international.html's dropdown. "Others" and any unrecognized
// value get no conversion. NOTE: static fallback rates for display only —
// not for billing/payment. Update periodically to stay reasonable.
export const MERCH_FX_FROM_PHP = {
  'Australia':    { code: 'AUD', symbol: 'A$', rate: 0.0273 },
  'South Korea':  { code: 'KRW', symbol: '₩',  rate: 24.4 },
  'Pakistan':     { code: 'PKR', symbol: '₨',  rate: 5.03 },
  'India':        { code: 'INR', symbol: '₹',  rate: 1.51 },
  'USA':          { code: 'USD', symbol: '$',  rate: 0.0177 },
};

// Fetches live PHP-based rates for the currencies we display, falling back
// to the static table above per-currency if the API is unreachable or a
// given currency is missing from the response. Timeboxed (4s) so a slow/dead
// API adds bounded latency rather than hanging the request indefinitely, and
// never throws — a failure just means static fallback rates get used. Call
// once per request/batch — never per recipient/product — and reuse the
// result; callers should also skip calling this at all when the country
// isn't mapped, since the result would just be discarded (see MERCH_FX_FROM_PHP).
export async function fetchLiveMerchFx() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://open.er-api.com/v6/latest/PHP', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`FX API responded ${res.status}`);
    const json = await res.json();
    const rates = json?.rates;
    if (!rates) throw new Error('FX API response missing rates');

    const live = {};
    for (const [country, fallback] of Object.entries(MERCH_FX_FROM_PHP)) {
      const liveRate = rates[fallback.code];
      live[country] = Number.isFinite(liveRate) ? { ...fallback, rate: liveRate } : fallback;
    }
    return live;
  } catch (err) {
    console.error('[merch-fx] live fetch failed, using static fallback rates:', err.message);
    return { ...MERCH_FX_FROM_PHP };
  }
}

// Returns { code, symbol, amount } for a PHP amount converted into the
// participant's country currency, or null if the country isn't mapped or
// the amount isn't a finite number.
export function convertFromPHP(phpAmount, country, fxRates = MERCH_FX_FROM_PHP) {
  const fx = fxRates[country];
  const n  = Number(phpAmount);
  if (!fx || !Number.isFinite(n)) return null;
  return { code: fx.code, symbol: fx.symbol, amount: n * fx.rate };
}

// Formatted "~$6.20 USD" string for email bodies, built on convertFromPHP.
export function approxConversion(phpAmount, country, fxRates = MERCH_FX_FROM_PHP) {
  const converted = convertFromPHP(phpAmount, country, fxRates);
  if (!converted) return null;
  const decimals = converted.code === 'KRW' ? 0 : 2;
  return `~${converted.symbol}${converted.amount.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${converted.code}`;
}
