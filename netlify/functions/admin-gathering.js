// netlify/functions/admin-gathering.js
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../lib/mailer.js";
import { sendGatheringPaymentConfirmedEmail, sendGatheringCancellationEmail, sendGatheringRegistrationReceivedEmail, sendGatheringFoodCodeEmail, GATHERING_CANCELLATION_REASONS } from "../lib/gathering-email.js";
import { getAdmin } from "../lib/admin-auth.js";

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers    = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "relay2026secret";


export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  const admin = await getAdmin(event, supabase);
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

      // Round 110: bulk send, not scoped to one row — handled before the
      // `!id` guard below since this action has no single target.
      if (action === "blast_food_codes") {
        if (!admin.permissions?.verify_payment || admin.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "No permission" }) };
        }
        const { provider, ids } = body;
        const providerOverride = (provider === "resend" || provider === "gmail") ? provider : undefined;
        // Round 114: now always scoped to an explicit selection from the
        // admin panel's checkbox UI — no more implicit "everyone" default,
        // since that's exactly the kind of one-click-blasts-hundreds-of-
        // people footgun the checkbox selection was built to replace.
        if (!Array.isArray(ids) || !ids.length) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "No registrants selected." }) };
        }
        // Every non-cancelled row in the selection, regardless of
        // payment_status — food distribution is a venue check-in concern
        // independent of payment (plan's Confirmed Rule #1), so a
        // venue-pay/unpaid registrant is just as entitled to their code as
        // a confirmed GCash one. Still re-checked server-side (not just
        // trusting the client's selection) in case a row was cancelled
        // between the admin loading the page and clicking Send.
        const { data: rows, error: fetchErr } = await supabase
          .from("gathering_registrations")
          .select("*")
          .in("id", ids)
          .neq("payment_status", "cancelled");
        if (fetchErr) throw fetchErr;

        let sent = 0, skipped = 0;
        // Sequential, not Promise.all — this can be a few hundred rows and
        // sequential keeps it well clear of the mailer's/Netlify's rate
        // limits, matching how every other bulk-send in this admin panel
        // already behaves. sendGatheringFoodCodeEmail never throws (it
        // catches internally and records status on the row, same as every
        // other Gathering send) — per-row success/failure is what the
        // 🍱 icon in the Emails column reflects after this reloads, this
        // count is only a rough "did we even attempt it" summary for the
        // toast.
        for (const row of (rows || [])) {
          if (!row.email || !row.food_qr_code || !row.food_passcode) { skipped++; continue; }
          await sendGatheringFoodCodeEmail(sendEmail, row, providerOverride);
          sent++;
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent, skipped, total: (rows || []).length }) };
      }

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
        //
        // Was gated on `gathering_email_updates`, which is actually the
        // unrelated "receive Gathering registration-alert emails"
        // subscription toggle (see submit-gathering.js) — an admin without
        // that flag but WITH verify_payment (the permission that gates
        // every other action in this file, and the one that actually
        // governs managing the Gathering tab) got a spurious "No
        // permission" error just for clicking resend/retry. Fixed to match
        // the rest of this file's convention.
        if (!admin.permissions?.verify_payment || admin.force_password_change) {
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
        } else if (type === "food_code") {
          // Round 110. Unlike the other three types this isn't gated on
          // payment_status at all — a food code is valid the moment the
          // row exists, cancelled rows excepted (checked below), since
          // it's a venue check-in concern rather than a payment one.
          if (row.payment_status === "cancelled") {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "This registration is cancelled — nothing to send." }) };
          }
          await sendGatheringFoodCodeEmail(sendEmail, row, providerOverride);
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
