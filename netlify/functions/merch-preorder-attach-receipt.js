import { createClient } from '@supabase/supabase-js';
import { getAdmin } from '../lib/admin-auth.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';


export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  // Allow both admin and public users to attach receipts; admin privileges are not required to upload a receipt.
  const admin = await getAdmin(event, supabase);

  try {
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const id = body.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing preorder id' }) };
      const receiptUrl = String(body.url || '').trim() || null;
      const receiptPath = String(body.path || '').trim() || null;

      const updates = { receipt_url: receiptUrl, receipt_path: receiptPath };
      if (receiptUrl) updates.payment_status = 'uploaded';
      // Only touch deposit_amount when the caller actually sends one — it's
      // already recorded at checkout, so a receipt-only upload shouldn't zero it out.
      if (body.deposit_amount !== undefined && body.deposit_amount !== null) {
        updates.deposit_amount = Number.parseInt(body.deposit_amount, 10) || 0;
      }

      const { error } = await supabase.from('merch_preorders').update(updates).eq('id', id);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('[merch-preorder-attach-receipt]', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
