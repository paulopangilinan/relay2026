// netlify/functions/get-registration.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const { id, group_id } = event.queryStringParameters || {};
  if (!id && !group_id) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing ID" }) };

  try {
    // Fetch the primary registration
    const { data, error } = await supabase
      .from("registrations")
      .select("id, name, church, student_status, payment_verified, status, group_id, group_size")
      .eq("id", id)
      .single();

    if (error || !data) return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found" }) };

    // If it's a group, fetch all members
    let members = null;
    if (data.group_id) {
      const { data: groupMembers } = await supabase
        .from("registrations")
        .select("id, name, student_status")
        .eq("group_id", data.group_id)
        .order("created_at");
      members = groupMembers || [];
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ...data, members }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
