// netlify/functions/admin-gathering.js
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import { sendEmail } from "../lib/mailer.js";
import { sendGatheringPaymentConfirmedEmail, sendGatheringCancellationEmail, sendGatheringRegistrationReceivedEmail, GATHERING_CANCELLATION_REASONS } from "../lib/gathering-email.js";

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers    = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "relay2026secret";

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || "").replace("Bearer ", "");
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  const admin = getAdmin(event);
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    if (event.httpMethod === "GET") {
      const { data, error } = await supabase
        .from("gathering_registrations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ registrations: data || [] }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, id } = body;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing id" }) };

      const { data: row, error: fetchErr } = await supabase
        .from("gathering_registrations").select("*").eq("id", id).single();
      if (fetchErr || !row) return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found" }) };

      if (action === "confirm") {
        // Only admins with verify_payment may confirm a GCash payment —
        // matches the permission gate used by every other payment-confirming
        // action in admin-data.js. Being logged in as *some* admin is not
        // enough on its own.
        if (!admin.permissions?.verify_payment || admin.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "No permission" }) };
        }
        // Only GCash rows are confirmable here. Venue payments are never
        // marked confirmed through this panel — they stay 'unpaid' until
        // the participant actually checks in at the venue, which is a
        // separate flow.
        if (row.payment_method !== "gcash") {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Only GCash payments can be confirmed here. Venue payments are confirmed at check-in." }) };
        }
        const { data: updated, error } = await supabase
          .from("gathering_registrations")
          .update({ payment_status: "confirmed", verified_at: new Date().toISOString(), verified_by: admin.email || "admin" })
          .eq("id", id).select().single();
        if (error) throw error;

        // Awaited (not fire-and-forget) — see submit-gathering.js for why
        // this matters: an un-awaited send isn't guaranteed to finish
        // before Netlify freezes the function. Also lets the delivery
        // status write-back (inside sendGatheringPaymentConfirmedEmail)
        // reliably land before this handler returns.
        await sendGatheringPaymentConfirmedEmail(sendEmail, updated);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, registration: updated }) };
      }

      if (action === "cancel") {
        // Cancellable for either payment method — venue registrations can be
        // duplicates/no-shows-in-advance too, not just unverifiable GCash
        // receipts. Anything already 'confirmed' or already 'cancelled' is
        // final and not reversible from here.
        if (!admin.permissions?.verify_payment || admin.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "No permission" }) };
        }
        if (row.payment_status !== "unpaid" && row.payment_status !== "pending_review") {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Only an unpaid or pending-review registration can be cancelled." }) };
        }
        const { reason, notify } = body;
        if (!reason || !GATHERING_CANCELLATION_REASONS[reason]) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "A valid cancellation reason is required." }) };
        }
        const { data: updated, error } = await supabase
          .from("gathering_registrations")
          .update({ payment_status: "cancelled", cancellation_reason: reason, verified_at: new Date().toISOString(), verified_by: admin.email || "admin" })
          .eq("id", id).select().single();
        if (error) throw error;

        // Reason is always stored above regardless of notify — the email
        // itself (always via Gmail, see gathering-email.js) is optional.
        if (notify) await sendGatheringCancellationEmail(sendEmail, updated, reason);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, registration: updated }) };
      }

      if (action === "update_count") {
        // Removed: admins no longer edit participant_count after
        // submission. What was submitted is honored as-is; if a
        // participant's headcount changes, they register again as a
        // separate batch instead. Endpoint intentionally left rejecting
        // this action in case any stale client still calls it.
        return { statusCode: 410, headers, body: JSON.stringify({ error: "Editing participant count is no longer supported. Ask the participant to submit a new registration for any additional participants." }) };
      }

      if (action === "resend_email") {
        // Lets an admin manually retry a failed (or force-retry a
        // successful) delivery straight from the table, now that every
        // send records its own outcome instead of failing silently.
        if (!admin.permissions?.gathering_email_updates || admin.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "No permission" }) };
        }
        const { type, provider } = body;
        // Optional per-click provider choice from the admin panel's
        // confirm modal ('resend' | 'gmail') — anything else is ignored so
        // this always falls back to the site-wide gathering_email_provider
        // setting, same as before this existed.
        const providerOverride = (provider === "resend" || provider === "gmail") ? provider : undefined;
        if (type === "registration") {
          await sendGatheringRegistrationReceivedEmail(sendEmail, row, providerOverride);
        } else if (type === "payment_confirmed") {
          if (row.payment_status !== "confirmed") {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "This registration isn't confirmed — nothing to resend." }) };
          }
          await sendGatheringPaymentConfirmedEmail(sendEmail, row, providerOverride);
        } else if (type === "cancellation") {
          if (row.payment_status !== "cancelled" || !row.cancellation_reason) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "This registration isn't cancelled (with a reason on file) — nothing to resend." }) };
          }
          // Defaults to Gmail (see sendGatheringCancellationEmail's
          // comment) but now honors an admin's one-off Resend override
          // same as the other two email types.
          await sendGatheringCancellationEmail(sendEmail, row, row.cancellation_reason, providerOverride);
        } else {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown email type." }) };
        }
        const { data: refreshed, error } = await supabase
          .from("gathering_registrations").select("*").eq("id", id).single();
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, registration: refreshed }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
    }

    return { statusCode: 405, headers, body: "Method Not Allowed" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong." }) };
  }
};
