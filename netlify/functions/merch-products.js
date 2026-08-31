import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const admin = getAdmin(event);
  if (!admin) return json(401, { error: 'Unauthorized' });
  if (!admin.permissions?.verify_payment && !admin.is_super_admin) return json(403, { error: 'No permission' });

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('merch_products')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return json(200, { products: (data || []).map(toClient) });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const product = normalizeProduct(body.product || body);
      const id = body.id || body.product?.id || null;

      if (id) {
        const { data, error } = await supabase
          .from('merch_products')
          .update({ ...product, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return json(200, { success: true, product: toClient(data) });
      }

      const { data, error } = await supabase
        .from('merch_products')
        .insert(product)
        .select()
        .single();
      if (error) throw error;
      return json(200, { success: true, product: toClient(data) });
    }

    if (event.httpMethod === 'PATCH') {
      // Bulk sort_order update: { orders: [{id, sortOrder}] }
      const body = JSON.parse(event.body || '{}');
      const orders = Array.isArray(body.orders) ? body.orders : [];
      if (!orders.length) return json(400, { error: 'No orders provided' });
      for (const { id, sortOrder } of orders) {
        if (!id) continue;
        const { error } = await supabase
          .from('merch_products')
          .update({ sort_order: Number(sortOrder) || 0, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
      }
      return json(200, { success: true });
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) return json(400, { error: 'Missing product id' });
      const { error } = await supabase.from('merch_products').delete().eq('id', id);
      if (error) throw error;
      return json(200, { success: true });
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('[merch-products]', err);
    return json(500, { error: err.message });
  }
};

function normalizeProduct(raw) {
  const name = String(raw.name || '').trim();
  if (!name) throw new Error('Product name is required');

  const price = Math.max(0, Number.parseInt(raw.price, 10) || 0);
  // Blank purchase limit means unlimited — only coerce to a number when
  // something was actually entered; don't default a blank field to 1.
  const rawLimit = raw.purchaseLimit ?? raw.purchase_limit;
  const purchaseLimit = (rawLimit === null || rawLimit === undefined || rawLimit === '')
    ? null
    : Math.max(1, Number.parseInt(rawLimit, 10) || 1);
  const sortOrder = Number.parseInt(raw.sortOrder ?? raw.sort_order, 10) || 0;
  const sizes = normalizeList(raw.sizes).slice(0, 30);
  const images = normalizeList(raw.images).slice(0, 10);
  let stock = {};
  try {
    if (raw.stock) stock = typeof raw.stock === 'string' ? JSON.parse(raw.stock) : raw.stock;
  } catch (e) { stock = {}; }

  return {
    name,
    price,
    sizes,
    purchase_limit: purchaseLimit,
    images,
    stock,
    availability: String(raw.availability || '').trim() || null,
    description: String(raw.description || '').trim() || null,
    sold_out: !!(raw.soldOut ?? raw.sold_out),
    is_active: raw.isActive ?? raw.is_active ?? true,
    sort_order: sortOrder,
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/\r?\n|,/)
    .map(v => v.trim())
    .filter(Boolean);
}

function toClient(p) {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    sizes: Array.isArray(p.sizes) ? p.sizes : [],
    purchaseLimit: p.purchase_limit,
    images: Array.isArray(p.images) ? p.images : [],
    availability: p.availability || '',
    description: p.description || '',
    soldOut: !!p.sold_out,
    isActive: !!p.is_active,
    sortOrder: p.sort_order || 0,
    stock: p.stock || {},
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}
