// netlify/functions/gathering-counter.js
// Public, unauthenticated aggregate for the repurposed /distro-ctr venue
// display — registrant count + total participant count for Gathering
// Around the Gospel. Deliberately returns ONLY two numbers, no
// participant-level data at all, same reasoning as distro-counter.js
// (this is meant to run on an unattended screen). Cancelled registrations
// are excluded, matching the admin dashboard's own "Total Registrants" /
// "N total participants" tile (see renderGatheringTiles() in
// admin/index.html) so this screen's numbers always agree with it.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers  = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const { data: rows, error } = await supabase
      .from("gathering_registrations")
      .select("participant_count")
      .neq("payment_status", "cancelled");
    if (error) throw error;

    const registrantCount   = (rows || []).length;
    const totalParticipants = (rows || []).reduce((sum, r) => sum + (r.participant_count || 0), 0);

    return { statusCode: 200, headers, body: JSON.stringify({ registrantCount, totalParticipants }) };
  } catch (err) {
    console.error("[gathering-counter]", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong." }) };
  }
};
