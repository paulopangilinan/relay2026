// netlify/functions/get-registration.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const { id } = event.queryStringParameters || {};
  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing ID" }) };

  try {
    const { data, error } = await supabase
      .from("registrations")
      .select("id, name, church, student_status, payment_verified, status")
      .eq("id", id)
      .single();

    if (error || !data) return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found" }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
