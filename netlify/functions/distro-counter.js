// netlify/functions/distro-counter.js
// Round 110: public, unauthenticated aggregate for the /distro-ctr venue
// display. Deliberately returns ONLY two numbers — no participant-level
// data at all — since this is meant to run on an unattended screen.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers  = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const { data: rows, error } = await supabase
      .from("gathering_registrations")
      .select("participant_count, food_claimed")
      .neq("payment_status", "cancelled");
    if (error) throw error;

    let totalPacks = 0, claimedPacks = 0;
    for (const r of (rows || [])) {
      totalPacks += r.participant_count || 0;
      if (r.food_claimed) claimedPacks += r.participant_count || 0;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ totalPacks, claimedPacks }) };
  } catch (err) {
    console.error("[distro-counter]", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong." }) };
  }
};
