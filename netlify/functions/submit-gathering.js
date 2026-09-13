// netlify/functions/submit-gathering.js
// Handles form submissions from /gathering (Gathering Around the Gospel).
// Intentionally minimal — name + headcount + payment method only. Not
// wired into the main `registrations` table or its email/SMS pipeline.
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendEmail } from "../lib/mailer.js";
import { gatheringHeroUrl, gatheringEmailShell, escapeHtml, GATHERING_HEADER_GRADIENT_BLUE, GATHERING_HEADER_GRADIENT_GREEN, sendGatheringRegistrationReceivedEmail, getGatheringEmailProvider } from "../lib/gathering-email.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

// Snapshotted per-row at insert time (see fee_per_head column) so a later
// change to this env var never rebills someone who already registered.
const DEFAULT_FEE_PHP = 200;

// Hard backstop behind the client-side check on gathering.html — matches
// the "up to 5MB" label shown on the upload box there.
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// Mirrors the same computed cutoff used by site-settings.js — kept in sync
// manually since these are two separate functions; both fall open (allow
// submission) if GATHERING_REG_END is unset or unparsable, and both default
// to the same tentative date/time.
const DEFAULT_GATHERING_REG_END = "2026-09-25T17:00:00+08:00";
function isPastGatheringCutoff() {
  const end = process.env.GATHERING_REG_END || DEFAULT_GATHERING_REG_END;
  const endTime = new Date(end).getTime();
  if (isNaN(endTime)) return false;
  return Date.now() >= endTime;
}

// Adjustable live in admin Settings, mirrors site-settings.js. Counts every
// non-cancelled registration's participant_count — cancelled rows free up
// their slots, same exclusion as site-settings.js's getGatheringParticipantTotal().
const DEFAULT_GATHERING_MAX_PARTICIPANTS = 500;
async function isGatheringCapped() {
  try {
    const [{ data: settings }, { data: rows }] = await Promise.all([
      supabase.from("site_settings").select("gathering_max_participants").eq("id", true).maybeSingle(),
      supabase.from("gathering_registrations").select("participant_count").neq("payment_status", "cancelled"),
    ]);
    const max = settings?.gathering_max_participants ?? DEFAULT_GATHERING_MAX_PARTICIPANTS;
    const total = (rows || []).reduce((sum, r) => sum + (r.participant_count || 0), 0);
    return total >= max;
  } catch {
    return false; // fail open — a settings/count read error shouldn't block registration
  }
}

// Round 32: config switch to hide/disable "Pay at Venue" — defaults OFF,
// opposite of isGatheringCapped()/isPastGatheringCutoff() above. This is the
// one Gathering check that fails CLOSED on a read error: those checks guard
// against blocking registration unnecessarily, but this one guards a
// business rule the admin explicitly turned off, so a settings-read error
// should never let a disabled payment method slip through.
async function isVenuePaymentEnabled() {
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("gathering_venue_payment_enabled")
      .eq("id", true)
      .maybeSingle();
    if (error) return false;
    return !!data?.gathering_venue_payment_enabled;
  } catch {
    return false; // fail CLOSED
  }
}

// Round 60: per-submission capacity check (Option A — reject outright, with
// a live remaining-count hint on the client as Option C). Separate from
// isGatheringCapped() above, which only answers "are we fully full" for the
// closed-registration gate; this returns the actual remaining count so a
// registration that would overshoot the cap can be rejected with a specific
// number, even while slots are technically still open.
async function getGatheringRemainingSlots() {
  try {
    const [{ data: settings }, { data: rows }] = await Promise.all([
      supabase.from("site_settings").select("gathering_max_participants").eq("id", true).maybeSingle(),
      supabase.from("gathering_registrations").select("participant_count").neq("payment_status", "cancelled"),
    ]);
    const max = settings?.gathering_max_participants ?? DEFAULT_GATHERING_MAX_PARTICIPANTS;
    const total = (rows || []).reduce((sum, r) => sum + (r.participant_count || 0), 0);
    return Math.max(0, max - total);
  } catch {
    return null; // read error — treat as "unknown", don't block on it (same fail-open spirit as isGatheringCapped)
  }
}

async function isRegistrationClosed() {
  if (isPastGatheringCutoff()) return true;
  if (await isGatheringCapped()) return true;
  try {
    const { data } = await supabase.from("site_settings").select("reg_gathering_closed").eq("id", true).maybeSingle();
    return !!data?.reg_gathering_closed;
  } catch {
    return false; // fail open — a settings read error shouldn't block registration
  }
}

// Builds the shared info body (participants/payment/contact/car) used by
// both the venue and GCash admin-notify variants below.
function gatheringNotifyBody(row) {
  const carRow = row.bringing_car
    ? `<p style="margin:0 0 4px;">Car: <strong>${escapeHtml(row.car_maker || "")} ${escapeHtml(row.car_model || "")}</strong> — Plate <strong>${escapeHtml(row.car_plate || "")}</strong></p>`
    : `<p style="margin:0 0 4px;">Bringing a car: <strong>No</strong></p>`;
  return `
    <p style="margin:0 0 10px;"><strong>${escapeHtml(row.name)}</strong> just registered for Gathering Around the Gospel.</p>
    <p style="margin:0 0 4px;">Participants: <strong>${row.participant_count}</strong></p>
    <p style="margin:0 0 4px;">Payment method: <strong>${row.payment_method === "gcash" ? "GCash" : "Pay at Venue"}</strong></p>
    <p style="margin:0 0 4px;">Amount due: <strong>₱${row.amount_due?.toLocaleString?.() ?? row.amount_due}</strong></p>
    <p style="margin:0 0 4px;">Email: ${escapeHtml(row.email)}</p>
    <p style="margin:0 0 4px;">Mobile: ${escapeHtml(row.mobile)}</p>
    ${carRow}`;
}

// Pay-at-venue admin-notify — green gradient header, purely informational.
// Venue payments are never confirmable from admin (only at check-in), so
// there's no CTA here.
function gatheringVenueNotifyEmail(row) {
  return gatheringEmailShell({
    heroUrl: gatheringHeroUrl(),
    headerBg: GATHERING_HEADER_GRADIENT_GREEN,
    headerTitle: "New Gathering Registration",
    body: gatheringNotifyBody(row),
    footer: "Review it from the Gathering tab in the admin dashboard.",
  });
}

// GCash admin-notify — blue gradient header (matches the main site's
// convention for "needs a payment confirmation" emails), plus an optional
// one-click "Confirm Payment" CTA for admins who can verify payments.
function gatheringGcashNotifyEmail(row, confirmLink, canVerify) {
  const cta = canVerify
    ? `<div style="text-align:center;margin-top:20px;"><a href="${confirmLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#2E7048;">✅ Confirm Payment</a></div>`
    : "";
  const receiptBlock = row.receipt_url
    ? `<div style="margin:14px 0 4px;">
        <p style="margin:0 0 6px;color:#6B8A9A;font-size:13px;">Receipt:</p>
        <a href="${row.receipt_url}" style="display:inline-block;"><img src="${row.receipt_url}" alt="Payment receipt" style="max-width:100%;width:280px;border-radius:8px;border:1px solid #E1E8ED;display:block;" /></a>
      </div>`
    : "";
  return gatheringEmailShell({
    heroUrl: gatheringHeroUrl(),
    headerBg: GATHERING_HEADER_GRADIENT_BLUE,
    headerTitle: "New Gathering Registration",
    body: `${gatheringNotifyBody(row)}
      ${receiptBlock}
      <div style="margin-top:10px;color:#6B8A9A;font-size:13px;">Check GCash to confirm payment was received${canVerify ? ", then click the button below to confirm." : "."}</div>
      ${cta}`,
    footer: "Review it from the Gathering tab in the admin dashboard.",
  });
}

async function notifyAdminsOfGatheringRegistration(row) {
  try {
    const { data: admins, error } = await supabase
      .from("admins")
      .select("email, name, permissions, force_password_change");
    if (error || !admins) return;
    const notifyAdmins = admins.filter(a => a.permissions?.gathering_email_updates && !a.force_password_change);
    if (!notifyAdmins.length) return;

    const isGcash = row.payment_method === "gcash";
    const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");
    const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "relay2026secret";
    const baseConfirmUrl = `${siteUrl}/.netlify/functions/confirm-gathering?id=${row.id}`;

    for (const admin of notifyAdmins) {
      let html;
      if (isGcash) {
        const canVerify = !!admin.permissions?.verify_payment;
        // Only mint a link (and show the CTA) for admins who are actually
        // allowed to confirm payments — mirrors submit.js's canVerify gate.
        const confirmLink = canVerify
          ? `${baseConfirmUrl}&atoken=${jwt.sign({ email: admin.email, name: admin.name }, JWT_SECRET, { expiresIn: "30d" })}`
          : baseConfirmUrl;
        html = gatheringGcashNotifyEmail(row, confirmLink, canVerify);
      } else {
        html = gatheringVenueNotifyEmail(row);
      }
      const subject = isGcash
        ? `New Gathering Registration + Payment — ${row.name}`
        : `New Gathering Registration — ${row.name}`;
      await sendEmail({ to: admin.email, subject, html, provider: await getGatheringEmailProvider() })
        .catch(err => console.error("Gathering admin-notify email failed:", err.message));
    }
  } catch (err) {
    console.error("notifyAdminsOfGatheringRegistration failed:", err.message);
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    if (await isRegistrationClosed()) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Registration for Gathering Around the Gospel is closed." }) };
    }

    const body = JSON.parse(event.body || "{}");
    const { name, email, mobile, participantCount, paymentMethod, receiptBase64, receiptName,
            bringingCar, carMaker, carModel, carPlate } = body;

    const cleanName  = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanMobile = String(mobile || "").trim();
    const count = parseInt(participantCount, 10);
    const hasCar = bringingCar === true || bringingCar === "true";

    if (!cleanName) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Name is required." }) };
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "A valid email is required." }) };
    }
    if (!cleanMobile) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Mobile number is required." }) };
    }
    if (!Number.isInteger(count) || count < 1) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Number of participants must be at least 1." }) };
    }
    // Checked here (right before further validation/insert) rather than only
    // in isRegistrationClosed() above, so a request that would push the
    // total over the cap is rejected with the actual remaining count —
    // registration can stay technically "open" while still not having room
    // for a party of this size. `remaining === null` means the capacity
    // read itself failed — fail open there rather than block on it.
    const remaining = await getGatheringRemainingSlots();
    if (remaining !== null && count > remaining) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({
          error: remaining > 0
            ? `Only ${remaining} spot${remaining === 1 ? "" : "s"} remain — please reduce your participant count and try again.`
            : "Sorry, Gathering Around the Gospel is fully booked.",
          remainingSlots: remaining,
        }),
      };
    }
    if (paymentMethod !== "venue" && paymentMethod !== "gcash") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid payment method." }) };
    }
    if (paymentMethod === "venue" && !(await isVenuePaymentEnabled())) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Pay at Venue is not available. Please pay via GCash." }) };
    }
    const cleanCarMaker = hasCar ? String(carMaker || "").trim() : null;
    const cleanCarModel = hasCar ? String(carModel || "").trim() : null;
    const cleanCarPlate = hasCar ? String(carPlate || "").trim() : null;
    if (hasCar && (!cleanCarMaker || !cleanCarModel || !cleanCarPlate)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Car maker, model, and plate number are required for parking." }) };
    }

    const feePerHead = parseInt(process.env.GATHERING_FEE_PHP, 10) || DEFAULT_FEE_PHP;
    const amountDue  = feePerHead * count;

    let receiptUrl = null;
    let receiptHash = null;
    let isFlaggedDuplicate = false;
    let duplicateMatchIds = [];
    if (paymentMethod === "gcash" && receiptBase64) {
      const buf = Buffer.from(receiptBase64, "base64");
      if (buf.length > MAX_RECEIPT_BYTES) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Receipt image is too large. Please upload a file under 5MB." }) };
      }
      // Byte-identical reuse check — catches submitting the same GCash
      // screenshot twice, which is what actually happened with the
      // Verastigue duplicate (see Round 63/64 investigation). This never
      // blocks the submission; it only flags both sides of a match for
      // admin review, since a hash match could also be an innocent
      // resubmission (e.g. retrying after not seeing a confirmation email).
      // Known limitation: a re-crop/re-compress/re-screenshot of the same
      // receipt changes the hash and won't be caught this way.
      receiptHash = crypto.createHash("sha256").update(buf).digest("hex");
      const { data: matches } = await supabase
        .from("gathering_registrations")
        .select("id")
        .eq("receipt_hash", receiptHash)
        .neq("payment_status", "cancelled");
      if (matches && matches.length) {
        isFlaggedDuplicate = true;
        duplicateMatchIds = matches.map(m => m.id);
      }

      const ext  = receiptName?.split(".").pop() || "jpg";
      const path = `gathering-receipts/${Date.now()}-${cleanName.replace(/\s+/g, "_")}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("relay-uploads")
        .upload(path, buf, { contentType: `image/${ext}` });
      if (!uploadErr) {
        const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
        receiptUrl = data.publicUrl;
      }
    }

    // Venue payments never move past 'unpaid' through this system — actual
    // confirmation happens when they show up at the venue, not here.
    const paymentStatus = paymentMethod === "gcash" ? "pending_review" : "unpaid";

    const { data: row, error: dbErr } = await supabase
      .from("gathering_registrations")
      .insert({
        name: cleanName,
        email: cleanEmail,
        mobile: cleanMobile,
        participant_count: count,
        payment_method: paymentMethod,
        fee_per_head: feePerHead,
        amount_due: amountDue,
        receipt_url: receiptUrl,
        receipt_hash: receiptHash,
        flagged_duplicate: isFlaggedDuplicate,
        payment_status: paymentStatus,
        bringing_car: hasCar,
        car_maker: cleanCarMaker,
        car_model: cleanCarModel,
        car_plate: cleanCarPlate,
      })
      .select()
      .single();

    if (dbErr) throw new Error("DB insert failed: " + dbErr.message);

    // Flag the other side(s) of the match too, so admin sees both rows
    // flagged — not just whichever one happened to submit second.
    if (duplicateMatchIds.length) {
      await supabase.from("gathering_registrations")
        .update({ flagged_duplicate: true })
        .in("id", duplicateMatchIds)
        .catch(err => console.error("Failed to flag matched duplicate row(s):", err.message));
    }

    // Awaited (not fire-and-forget) — Netlify's execution environment can
    // freeze the moment this handler's promise resolves, so an un-awaited
    // send here isn't guaranteed to actually finish. Individual failures
    // still never fail the participant's submission (both functions catch
    // internally and record status on the row instead of throwing).
    await notifyAdminsOfGatheringRegistration(row);
    await sendGatheringRegistrationReceivedEmail(sendEmail, row);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, id: row.id, amountDue, feePerHead, paymentStatus }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong. Please try again." }) };
  }
};
