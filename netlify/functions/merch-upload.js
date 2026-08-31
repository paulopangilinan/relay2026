import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

    const body = JSON.parse(event.body || '{}');
    const { filename, contentType, data, productId, path } = body;

    // If a path is provided and delete is requested, remove the object.
    if (body.action === 'delete' && path) {
      const { error } = await supabase.storage.from('relay-uploads').remove([path]);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (!filename || !contentType || !data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing file data' }) };

    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 120);
    const folder = productId ? `merch/${productId}` : 'merch/unassigned';
    const dest = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName}`;

    const buffer = Buffer.from(data, 'base64');
    const { error: upErr } = await supabase.storage.from('relay-uploads').upload(dest, buffer, { contentType });
    if (upErr) throw upErr;

    const { data: urlData } = supabase.storage.from('relay-uploads').getPublicUrl(dest);
    const publicUrl = urlData?.publicUrl || urlData?.publicURL || '';

    return { statusCode: 200, headers, body: JSON.stringify({ url: publicUrl, path: dest }) };
  } catch (err) {
    console.error('[merch-upload]', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
