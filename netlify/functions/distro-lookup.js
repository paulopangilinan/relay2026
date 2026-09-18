// netlify/functions/distro-lookup.js
// Round 110: food-pack distribution. Looks up gathering_registrations
// rows for the /distro page — by partial name (may return several
// matches, since names collide) or by an exact QR code / 6-char passcode
// (should return exactly one). Never returns food_qr_code/food_passcode
// back to the client — there's no reason the distro screen itself needs
// to display the secret it's supposed to be checking against.
import { createClient } from "@supabase/supabase-js";
import { getAdmin } from "../lib/admin-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers  = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const SELECT_FIELDS = "id, name, email, participant_count, payment_status, food_claimed, food_claimed_at, food_claimed_by, food_claimed_method";

function toResult(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    participantCount: row.participant_count,
    foodClaimed: row.food_claimed,
    foodClaimedAt: row.food_claimed_at,
    foodClaimedBy: row.food_claimed_by,
    foodClaimedMethod: row.food_claimed_method,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: "Method Not Allowed" };

  const admin = await getAdmin(event, supabase);
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  if (!admin.permissions?.food_distribution && !admin.is_super_admin) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "No permission" }) };
  }

  try {
    const { query, code } = event.queryStringParameters || {};

    if (code) {
      const cleanCode = code.trim();
      const { data: row, error } = await supabase
        .from("gathering_registrations")
        .select(SELECT_FIELDS)
        .neq("payment_status", "cancelled")
        .or(`food_qr_code.eq.${cleanCode},food_passcode.eq.${cleanCode.toUpperCase()}`)
        .maybeSingle();
      if (error) throw error;
      if (!row) return { statusCode: 404, headers, body: JSON.stringify({ error: "No registration matches that code." }) };
      return { statusCode: 200, headers, body: JSON.stringify({ results: [toResult(row)] }) };
    }

    if (query && query.trim().length >= 2) {
      const { data: rows, error } = await supabase
        .from("gathering_registrations")
        .select(SELECT_FIELDS)
        .neq("payment_status", "cancelled")
        .ilike("name", `%${query.trim()}%`)
        .order("name", { ascending: true })
        .limit(15);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ results: (rows || []).map(toResult) }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Provide a query (name) or code (QR/passcode)." }) };
  } catch (err) {
    console.error("[distro-lookup]", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong." }) };
  }
};
