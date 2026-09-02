import { createClient } from '@supabase/supabase-js';
import { readMerchToken, formatOrderCode, fetchLiveMerchFx, convertFromPHP, MERCH_FX_FROM_PHP } from '../lib/merch.js';
import { sendEmail } from '../lib/mailer.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  try {
    const isDev = process.env.ALLOW_MERCH_DEV === 'true' || String(event.headers.host || '').includes('localhost');
    const settings = await getMerchSettings();

    if (event.httpMethod === 'GET') {
      const token = event.queryStringParameters?.t || '';
      const isPreview = event.queryStringParameters?.preview === '1' || (!token && isDev);
      if (isPreview) {
        return json(200, {
          registration: { name: 'Preview Attendee', church: 'Conference Guest' },
          products: await activeProducts(),
          orders: [],
          purchased: {},
          preview: true,
          downpayment_percent: settings.downpaymentPercent,
          closed: settings.closed
        });
      }
      if (settings.closed) {
        return json(403, { closed: true, error: 'Merch preorder is currently closed' });
      }

      // allow developer testing via ?dev_reg=<registration_id> when ALLOW_MERCH_DEV=true or host is localhost
      const devReg = event.queryStringParameters?.dev_reg || null;
      const registrationId = (isDev && devReg) ? devReg : readMerchToken(token);
      if (!registrationId) return json(401, { error: 'Invalid or expired link' });

      const { data: reg, error } = await supabase
        .from('registrations')
        .select('id, name, email, church, registrant_type, country, status, payment_verified')
        .eq('id', registrationId)
        .maybeSingle();

      if (error) throw error;
      if (!allowedForMerch(reg)) return json(403, { error: 'This merch preorder link is not available for cancelled registrations' });

      // Live approximate PHP conversion for the participant's country, if we
      // have one mapped. Never blocks the page — falls back to static rates
      // (see fetchLiveMerchFx) and to no conversion at all if unmapped.
      // Live FX only matters when this participant's country is actually
      // mapped (see MERCH_FX_FROM_PHP) — skip the external call entirely for
      // everyone else (all PH/local registrants, plus unmapped countries)
      // rather than paying its latency for a result that'd be discarded.
      const fxRates = reg.country && reg.country in MERCH_FX_FROM_PHP ? await fetchLiveMerchFx() : null;
      const products = await activeProducts({ country: reg.country, fxRates });

      // Every previous order this participant has placed, matched by email +
      // name — the same key the admin dashboard groups orders by — so the
      // page can show their full order history and so the purchase-limit
      // check below spans everything they've ever ordered, not just the
      // newest submission.
      const { data: pastOrders, error: ordersErr } = await supabase
        .from('merch_preorders')
        .select('id, order_number, items, notes, total_amount, deposit_amount, status, payment_status, created_at')
        .eq('email', reg.email)
        .eq('participant_name', reg.name)
        .order('created_at', { ascending: false });
      if (ordersErr) throw ordersErr;

      return json(200, {
        registration: reg,
        products,
        orders: (pastOrders || []).map(o => ({ ...o, order_code: formatOrderCode(o.order_number) })),
        purchased: purchasedQtyByKey(pastOrders),
        downpayment_percent: settings.downpaymentPercent,
        closed: settings.closed
      });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      // allow developer testing via body.dev_reg when ALLOW_MERCH_DEV=true or host is localhost
      const registrationId = (isDev && body.dev_reg) ? body.dev_reg : readMerchToken(body.token || '');
      if (!registrationId) return json(401, { error: 'Invalid or expired link' });

      if (settings.closed && !isDev) {
        return json(403, { closed: true, error: 'Merch preorder is currently closed' });
      }

      const { data: reg, error } = await supabase
        .from('registrations')
        .select('id, name, email, church, status, payment_verified')
        .eq('id', registrationId)
        .maybeSingle();
      if (error) throw error;
      if (!allowedForMerch(reg)) return json(403, { error: 'Cancelled registrations cannot preorder merch' });

      const products = await activeProducts();
      const items = normalizeItems(body.items, products);
      if (!items.length) return json(400, { error: 'Choose at least one merch item' });

      // Purchase limits are per participant (matched by email + name, same
      // as the order history above) and per size, and apply across a
      // participant's ENTIRE order history — not just this submission —
      // otherwise submitting several separate preorders is an easy way
      // around the cap. A blank purchase_limit means no cap.
      const { data: pastOrdersForLimit, error: pastErr } = await supabase
        .from('merch_preorders')
        .select('items, status')
        .eq('email', reg.email)
        .eq('participant_name', reg.name);
      if (pastErr) throw pastErr;
      const overLimit = checkPurchaseLimits(items, products, purchasedQtyByKey(pastOrdersForLimit));
      if (overLimit.length) return json(400, { error: `Purchase limit reached for ${overLimit.join(', ')}` });

      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      // Require configured downpayment percentage (0 means no DP required)
      const deposit = Number.parseInt(body.deposit_amount || 0, 10) || 0;
      const dpPercent = settings.downpaymentPercent;
      const minDeposit = dpPercent > 0 ? Math.ceil(total * (dpPercent / 100)) : 0;
      if (deposit < minDeposit) {
        return json(400, { error: `A deposit of at least PHP ${minDeposit.toLocaleString()} (${dpPercent}%) is required` });
      }
      // Validate stock availability before inserting
      const insufficient = checkStockAvailability(items, products);
      if (insufficient.length) return json(400, { error: `Insufficient stock for ${insufficient.join(', ')}` });

      // Record the deposit amount inside notes for now.
      const noteText = `deposit_paid:${deposit}; ` + (String(body.notes || '').trim() || '');
      // Payment status starts from what was actually paid at checkout — most
      // orders will be 'unpaid' while there's no payment method configured
      // (DP% is 0), but this keeps things correct once DP is turned back on.
      const initialPaymentStatus = deposit <= 0 ? 'unpaid' : (deposit >= total ? 'paid' : 'partial');
      const { data: inserted, error: insertErr } = await supabase.from('merch_preorders').insert({
        registration_id: registrationId,
        participant_name: reg.name,
        email: reg.email,
        church: reg.church,
        items,
        total_amount: total,
        notes: noteText || null,
        deposit_amount: deposit,
        // Snapshot the DP% in effect right now, so a later change to the
        // global setting never rewrites what this specific order required.
        dp_percent: dpPercent,
        payment_status: initialPaymentStatus,
        status: 'pending',
      }).select('id, order_number').single();
      if (insertErr) throw insertErr;
      const orderCode = formatOrderCode(inserted?.order_number);

      // Let admins who opted in know a preorder came in, mirroring the
      // notification registrations send — best-effort, never blocks checkout.
      if (settings.orderEmailNotify) {
        try {
          await notifyAdminsOfMerchOrder({ reg, items, total, deposit, orderId: inserted?.id, orderCode });
        } catch (e) {
          console.error('[merch-preorder] admin notify failed:', e.message);
        }
      }

      // Decrement stock for purchased items
      for (const it of items) {
        try {
          const { data: prod } = await supabase.from('merch_products').select('stock').eq('id', it.product_id).maybeSingle();
          const cur = prod?.stock || {};
          const newStock = { ...cur };
          if (it.size) {
            const v = Number.parseInt(newStock[it.size] ?? -1, 10);
            if (v >= 0) newStock[it.size] = Math.max(0, v - it.quantity);
          } else {
            const v = Number.parseInt(newStock['__total'] ?? -1, 10);
            if (v >= 0) newStock['__total'] = Math.max(0, v - it.quantity);
          }
          await supabase.from('merch_products').update({ stock: newStock }).eq('id', it.product_id);
        } catch (e) { /* ignore stock update errors */ }
      }

      return json(200, { success: true, total_amount: total, id: inserted?.id, order_code: orderCode });
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('[merch-preorder]', err);
    return json(500, { error: err.message });
  }
};

function allowedForMerch(reg) {
  // Allow any registration that is not explicitly cancelled
  return !!reg && String(reg.status || '').toLowerCase() !== 'cancelled';
}

async function activeProducts({ country = null, fxRates = null } = {}) {
  const { data, error } = await supabase
    .from('merch_products')
    .select('id, name, price, sizes, purchase_limit, images, availability, description, sold_out, is_active, sort_order, stock')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    // Approximate live conversion of `price` into the participant's country
    // currency, or null when there's no country/mapping (e.g. PH local
    // registrants, or an "Others" free-text country on the intl form).
    priceConverted: country && fxRates ? convertFromPHP(p.price, country, fxRates) : null,
    sizes: Array.isArray(p.sizes) ? p.sizes : [],
    // A blank/unset purchase_limit means unlimited — don't default it to 1.
    purchaseLimit: (p.purchase_limit === null || p.purchase_limit === undefined || p.purchase_limit === '') ? null : Number(p.purchase_limit),
    images: Array.isArray(p.images) ? p.images : [],
    availability: p.availability || '',
    description: p.description || '',
    soldOut: !!p.sold_out,
    stock: p.stock || {},
    sortOrder: p.sort_order || 0,
  }));
}

function normalizeItems(rawItems, activeProductList) {
  const products = new Map(activeProductList.filter(p => !p.soldOut).map(p => [p.id, p]));
  return (Array.isArray(rawItems) ? rawItems : []).flatMap(raw => {
    const product = products.get(raw?.product_id);
    const quantity = Number.parseInt(raw?.quantity, 10);
    if (!product || !Number.isFinite(quantity) || quantity < 1) return [];
    const size = String(raw?.size || '').trim();
    if (product.sizes.length && !product.sizes.includes(size)) return [];
    // check stock availability: undefined = unlimited
    if (product.sizes.length) {
      const sVal = product.stock && (product.stock[size] ?? null);
      if (sVal !== null && sVal !== undefined && Number.parseInt(sVal,10) <= 0) return []; // sold out
    } else {
      const tVal = product.stock && (product.stock['__total'] ?? null);
      if (tVal !== null && tVal !== undefined && Number.parseInt(tVal,10) <= 0) return [];
    }
    return [{
      product_id: product.id,
      name: product.name,
      size: product.sizes.length ? size : null,
      // Per-line sanity cap only; the real (cumulative, cross-order) limit
      // check happens in checkPurchaseLimits(). null purchaseLimit = no cap.
      quantity: product.purchaseLimit === null ? quantity : Math.min(quantity, product.purchaseLimit),
      price: product.price,
      image: product.images?.[0] || null,
    }];
  });
}

// Sums quantity already ordered per product+size across a participant's
// orders, excluding cancelled ones. Keyed 'productId::size' (size is '' for
// items with no sizes).
function purchasedQtyByKey(orders) {
  const map = {};
  for (const o of (orders || [])) {
    if (o.status === 'cancelled') continue;
    for (const it of (Array.isArray(o.items) ? o.items : [])) {
      const key = it.product_id + '::' + (it.size || '');
      map[key] = (map[key] || 0) + Number(it.quantity || 0);
    }
  }
  return map;
}

// Checks this submission's items against each product's purchase_limit,
// counting what the participant has already purchased (purchasedQty) so the
// limit holds across every order they've placed, not just this one.
function checkPurchaseLimits(items, products, purchasedQty) {
  const map = new Map(products.map(p => [p.id, p]));
  const needed = {};
  for (const it of items) {
    const key = it.product_id + '::' + (it.size || '');
    needed[key] = (needed[key] || 0) + it.quantity;
  }
  const overLimit = [];
  for (const key of Object.keys(needed)) {
    const sep = key.lastIndexOf('::');
    const pid = key.slice(0, sep);
    const size = key.slice(sep + 2);
    const p = map.get(pid);
    if (!p || p.purchaseLimit === null) continue;
    const already = purchasedQty[key] || 0;
    if (already + needed[key] > p.purchaseLimit) {
      overLimit.push(p.name + (size ? ' (' + size + ')' : '') + ` — limit ${p.purchaseLimit}`);
    }
  }
  return overLimit;
}

function checkStockAvailability(items, products) {
  const map = new Map(products.map(p => [p.id, p]));
  const insufficient = [];
  const needed = {};
  for (const it of items) {
    const p = map.get(it.product_id);
    if (!p) continue;
    const key = it.size ? `${it.product_id}::${it.size}` : `${it.product_id}::__total`;
    needed[key] = (needed[key] || 0) + it.quantity;
  }
  for (const k of Object.keys(needed)) {
    const [pid, size] = k.split('::');
    const p = map.get(pid);
    if (!p) continue;
    if (size === '__total') {
      const cur = Number.parseInt(p.stock?.['__total'] ?? -1, 10);
      if (cur >= 0 && needed[k] > cur) insufficient.push(p.name + (p.sizes.length ? '' : ''));
    } else {
      const cur = Number.parseInt(p.stock?.[size] ?? -1, 10);
      if (cur >= 0 && needed[k] > cur) insufficient.push(p.name + ' ' + size);
    }
  }
  return insufficient;
}

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

async function getMerchSettings() {
  try {
    const { data } = await supabase
      .from('site_settings')
      .select('merch_preorder_closed, merch_downpayment_percent, merch_order_email_notify')
      .eq('id', true)
      .maybeSingle();
    return {
      closed: !!data?.merch_preorder_closed,
      downpaymentPercent: data?.merch_downpayment_percent !== undefined && data?.merch_downpayment_percent !== null ? Number(data.merch_downpayment_percent) : 0,
      orderEmailNotify: data?.merch_order_email_notify !== undefined && data?.merch_order_email_notify !== null ? !!data.merch_order_email_notify : true,
    };
  } catch {
    return { closed: false, downpaymentPercent: 0, orderEmailNotify: true };
  }
}

async function notifyAdminsOfMerchOrder({ reg, items, total, deposit, orderId, orderCode }) {
  const { data: admins, error } = await supabase
    .from('admins')
    .select('email, name, permissions, force_password_change');
  if (error) throw error;
  const notifyAdmins = (admins || []).filter(a => a.permissions?.merch_order_notify && !a.force_password_change);
  if (!notifyAdmins.length) return;

  // Same source used everywhere else — never derived from a request Host,
  // so this can't quietly break on a preview/local deploy.
  const imgUrl  = (process.env.IMAGE_SITE_URL || process.env.SITE_URL || '').replace(/\/+$/, '');
  const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;

  const itemsHtml = items.map(it =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #EDF2F5;">${escapeHtml(it.name)}${it.size ? ' · ' + escapeHtml(it.size) : ''}</td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #EDF2F5;text-align:center;">${it.quantity}</td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #EDF2F5;text-align:right;">PHP ${(it.price * it.quantity).toLocaleString()}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <div style="height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);"></div>
      <img src="${heroUrl}" alt="RELAY 2026" style="width:100%;display:block;">
      <div style="background:linear-gradient(135deg,#1C2B38,#2E7048);padding:20px 24px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">New Merch Preorder ${orderCode ? `· ${escapeHtml(orderCode)}` : ''}</h2>
      </div>
      <div style="padding:24px;">
        <p style="font-size:14px;color:#2A3D4A;margin:0 0 14px;"><strong>${escapeHtml(reg.name)}</strong> (${escapeHtml(reg.email)})${reg.church ? ' · ' + escapeHtml(reg.church) : ''} just submitted a merch preorder.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#2A3D4A;margin-bottom:14px;">
          <thead><tr style="background:#F7FAFB;"><th style="padding:6px 10px;text-align:left;">Item</th><th style="padding:6px 10px;">Qty</th><th style="padding:6px 10px;text-align:right;">Subtotal</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <p style="font-size:13px;color:#2A3D4A;margin:0 0 4px;">Total: <strong>PHP ${total.toLocaleString()}</strong></p>
        <p style="font-size:13px;color:#2A3D4A;margin:0;">Deposit recorded: <strong>PHP ${deposit.toLocaleString()}</strong></p>
      </div>
      <div style="background:#f7fafb;padding:14px 24px;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;">Order ID: ${escapeHtml(orderCode || orderId || '')} · Review and confirm it from the Orders tab in the admin dashboard.</div>
    </div>
  </body></html>`;

  for (const admin of notifyAdmins) {
    await sendEmail({
      to: admin.email,
      subject: `New Merch Preorder — ${reg.name}`,
      html,
    });
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
