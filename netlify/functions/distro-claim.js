// netlify/functions/distro-claim.js
// Round 110: food-pack distribution. Claims (or undoes a claim on) a
// single gathering_registrations row. Every check here re-validates
// server-side — the client-side lookup in distro-lookup.js is only ever
// a convenience for the UI, never trusted as proof a code was correct.
import { createClient } from "@supabase/supabase-js";
import { getAdmin } from "../lib/admin-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers  = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const RESULT_FIELDS = "id, name, participant_count, food_claimed, food_claimed_at, food_claimed_by, food_claimed_method";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  const admin = await getAdmin(event, supabase);
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  if (!admin.permissions?.food_distribution && !admin.is_super_admin) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "No permission" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { registrationId, action } = body;
    if (!registrationId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing registrationId" }) };

    const { data: row, error: fetchErr } = await supabase
      .from("gathering_registrations")
      .select("id, name, payment_status, food_qr_code, food_passcode, food_claimed")
      .eq("id", registrationId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row || row.payment_status === "cancelled") {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Registration not found or cancelled." }) };
    }

    // ── Undo a claim — confirmed Round 110 requirement. No audit-log
    //    table; this simply clears the claim fields back to unclaimed,
    //    same overwrite-not-append convention this codebase already uses
    //    for e.g. cancellation_reason. ──
    if (action === "unclaim") {
      if (!row.food_claimed) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "This food pack isn't marked as claimed." }) };
      }
      const { data: updated, error } = await supabase
        .from("gathering_registrations")
        .update({ food_claimed: false, food_claimed_at: null, food_claimed_by: null, food_claimed_method: null })
        .eq("id", registrationId)
        .select(RESULT_FIELDS)
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, registration: updated }) };
    }

    // ── Claim ──
    const { method, code } = body;
    if (!["qr", "passcode", "admin_override"].includes(method)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid claim method." }) };
    }

    if (method === "qr" || method === "passcode") {
      const submitted = String(code || "").trim();
      const expected = method === "qr" ? row.food_qr_code : row.food_passcode;
      // Case-insensitive on the passcode only — it's meant to be hand-typed
      // at a table; the QR token is opaque and compared exactly.
      const matches = method === "qr"
        ? submitted === expected
        : expected && submitted.toUpperCase() === expected.toUpperCase();
      if (!expected || !matches) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: "That code doesn't match this registration." }) };
      }
    } else if (method === "admin_override") {
      if (!body.confirmed) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "admin_override requires explicit confirmation." }) };
      }
    }

    // Single conditional UPDATE, not read-then-write — with 5-8 devices
    // potentially racing on the same row, only one request's UPDATE can
    // ever actually flip food_claimed false → true. Whichever request
    // loses gets 0 rows back and is told it's already claimed, rather
    // than both succeeding and double-counting.
    const { data: updatedRows, error: claimErr } = await supabase
      .from("gathering_registrations")
      .update({
        food_claimed: true,
        food_claimed_at: new Date().toISOString(),
        food_claimed_by: admin.email,
        food_claimed_method: method,
      })
      .eq("id", registrationId)
      .eq("food_claimed", false)
      .select(RESULT_FIELDS);
    if (claimErr) throw claimErr;

    if (!updatedRows || updatedRows.length === 0) {
      // Someone else's claim won the race (or it was already claimed
      // before this request even started) — fetch the current state so
      // the losing admin's screen can show who/when/how.
      const { data: current } = await supabase
        .from("gathering_registrations").select(RESULT_FIELDS).eq("id", registrationId).maybeSingle();
      return {
        statusCode: 409, headers,
        body: JSON.stringify({ error: `Already claimed${current?.food_claimed_by ? ` by ${current.food_claimed_by}` : ""}.`, registration: current }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, registration: updatedRows[0] }) };
  } catch (err) {
    console.error("[distro-claim]", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong." }) };
  }
};
