// netlify/lib/gathering-email.js
// Shared HTML email builders for "Gathering Around the Gospel" — used by
// submit-gathering.js (admin-notify), admin-gathering.js (manual confirm
// from the admin panel), and confirm-gathering.js (one-click email link).
// Kept in one place so the participant-facing "Payment Confirmed" email is
// always identical no matter which of the two confirm paths triggered it.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Which mail provider Gathering's own emails go through — configurable from
// admin Settings (`gathering_email_provider` column), independent of the
// repo-wide mailer default. Falls back to 'resend' (the current hardcoded
// behavior) if unset or on a read error, so this is purely additive.
// `sendGatheringPaymentConfirmedEmail`/`sendGatheringRegistrationReceivedEmail`
// both accept an optional trailing `providerOverride` ('resend' | 'gmail')
// that skips this lookup entirely — used by admin-gathering.js's manual
// resend/retry action, where the admin picks the provider per click rather
// than always using the site-wide setting.
export async function getGatheringEmailProvider() {
  try {
    const { data } = await supabase.from("site_settings").select("gathering_email_provider").eq("id", true).maybeSingle();
    const p = data?.gathering_email_provider;
    return (p === "gmail" || p === "resend") ? p : "resend";
  } catch {
    return "resend";
  }
}

export function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function gatheringHeroUrl() {
  const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const imgUrl  = (process.env.IMAGE_SITE_URL || siteUrl).replace(/\/+$/, "");
  return `${imgUrl}/assets/images/gathering-hero-email.jpg?v=${Date.now()}`;
}

// Two-tone diagonal gradients — same palette used repo-wide (verify.js,
// admin-data.js, submit.js): blue for "awaiting/needs confirmation",
// green for "confirmed / pay-at-venue". Slate for cancellations — neither
// "awaiting" nor "confirmed" applies to a cancelled row.
export const GATHERING_HEADER_GRADIENT_BLUE  = "linear-gradient(135deg,#1C2B38,#3A8BBF)";
export const GATHERING_HEADER_GRADIENT_GREEN = "linear-gradient(135deg,#1C2B38,#2E7048)";
export const GATHERING_HEADER_GRADIENT_RED   = "linear-gradient(135deg,#1C2B38,#C0392B)";

// Writes the outcome of a send attempt back onto the row so the admin panel
// can show a real ✅/❌ indicator and offer a Resend button, instead of the
// old fire-and-forget "console.error and hope" approach. `kind` picks which
// column triple to update. Never throws — a failed status write shouldn't
// crash the caller, it just means the indicator stays stale until next time.
async function recordGatheringEmailStatus(rowId, kind, status, provider) {
  try {
    await supabase.from("gathering_registrations").update({
      [`${kind}_email_status`]: status,
      [`${kind}_email_provider`]: provider || null,
      [`${kind}_email_sent_at`]: new Date().toISOString(),
    }).eq("id", rowId);
  } catch (err) {
    console.error(`Failed to record ${kind} email status:`, err.message);
  }
}

/**
 * Base email shell shared by all Gathering emails — hero image, 4px
 * gradient bar, a header block (color/title supplied by caller), a body,
 * and a footer.
 */
export function gatheringEmailShell({ heroUrl, headerBg, headerTitle, body, footer }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <img src="${heroUrl}" alt="Gathering Around the Gospel" style="display:block;width:100%;height:auto;">
      <div style="height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);"></div>
      <div style="background:${headerBg};padding:20px 24px;"><h2 style="color:#fff;margin:0;font-size:18px;">${headerTitle}</h2></div>
      <div style="padding:24px;font-size:14px;color:#2A3D4A;line-height:1.6;">${body}</div>
      ${footer ? `<div style="background:#f7fafb;padding:14px 24px;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;">${footer}</div>` : ""}
    </div>
  </body></html>`;
}

/**
 * Participant-facing "Payment Confirmed" email — identical whether it was
 * triggered from the admin panel's manual Confirm button or the one-click
 * email link (confirm-gathering.js).
 */
export function gatheringPaymentConfirmedEmail(row) {
  return gatheringEmailShell({
    heroUrl: gatheringHeroUrl(),
    headerBg: GATHERING_HEADER_GRADIENT_GREEN,
    headerTitle: "Payment Confirmed ✅",
    body: `
      <p style="margin:0 0 10px;">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0 0 10px;">We've confirmed your GCash payment for <strong>Gathering Around the Gospel</strong> — ${row.participant_count} participant(s), ₱${row.amount_due?.toLocaleString?.() ?? row.amount_due}.</p>
      <p style="margin:0;">See you on September 25 at CCT Tagaytay Retreat &amp; Training Center!</p>`,
  });
}

export async function sendGatheringPaymentConfirmedEmail(sendEmail, row, providerOverride) {
  if (!row.email) return;
  const provider = providerOverride || await getGatheringEmailProvider();
  try {
    await sendEmail({
      to: row.email,
      subject: "Payment Confirmed — Gathering Around the Gospel",
      html: gatheringPaymentConfirmedEmail(row),
      provider,
    });
    await recordGatheringEmailStatus(row.id, "payment_confirmed", "sent", provider);
  } catch (err) {
    console.error("Gathering payment-confirmed email failed:", err.message);
    await recordGatheringEmailStatus(row.id, "payment_confirmed", "failed", provider);
  }
}

// Shared field list (participants/payment/amount/car) for the
// registration-received email, addressed to the registrant rather than an
// admin. Kept here (not in submit-gathering.js's admin-facing
// gatheringNotifyBody) since the wording is participant-facing throughout.
function gatheringReceivedBody(row) {
  const isGcash = row.payment_method === "gcash";
  const carLine = row.bringing_car
    ? `<p style="margin:0 0 4px;">Car: <strong>${escapeHtml(row.car_maker || "")} ${escapeHtml(row.car_model || "")}</strong> — Plate <strong>${escapeHtml(row.car_plate || "")}</strong></p>`
    : `<p style="margin:0 0 4px;">Bringing a car: <strong>No</strong></p>`;
  const paymentNote = isGcash
    ? `<p style="margin:14px 0 0;color:#6B8A9A;font-size:13px;">We'll confirm your payment shortly — you'll get another email once it's verified.</p>`
    : `<p style="margin:14px 0 0;color:#6B8A9A;font-size:13px;">Please pay ₱${row.amount_due?.toLocaleString?.() ?? row.amount_due} at the venue.</p>`;
  return `
    <p style="margin:0 0 10px;">Hi ${escapeHtml(row.name)},</p>
    <p style="margin:0 0 10px;">Thanks for registering for <strong>Gathering Around the Gospel</strong>! Here's a copy of your registration:</p>
    <p style="margin:0 0 4px;">Participants: <strong>${row.participant_count}</strong></p>
    <p style="margin:0 0 4px;">Payment method: <strong>${isGcash ? "GCash" : "Pay at Venue"}</strong></p>
    <p style="margin:0 0 4px;">Amount due: <strong>₱${row.amount_due?.toLocaleString?.() ?? row.amount_due}</strong></p>
    ${carLine}
    <p style="margin:14px 0 0;">📍 CCT Tagaytay Retreat &amp; Training Center — September 25, 2026, 7:00–9:30 PM</p>
    ${paymentNote}`;
}

/**
 * Participant-facing "you're registered" email — sent immediately on every
 * successful submission (venue AND GCash), unlike gatheringPaymentConfirmedEmail
 * above which only ever fires later for GCash once an admin confirms.
 * Header color follows the same "blue = awaiting confirmation, green =
 * nothing left to confirm" convention as the admin-notify emails.
 */
export function gatheringRegistrationReceivedEmail(row) {
  const isGcash = row.payment_method === "gcash";
  return gatheringEmailShell({
    heroUrl: gatheringHeroUrl(),
    headerBg: isGcash ? GATHERING_HEADER_GRADIENT_BLUE : GATHERING_HEADER_GRADIENT_GREEN,
    headerTitle: "You're Registered! 🎉",
    body: gatheringReceivedBody(row),
  });
}

export async function sendGatheringRegistrationReceivedEmail(sendEmail, row, providerOverride) {
  if (!row.email) return;
  const provider = providerOverride || await getGatheringEmailProvider();
  try {
    await sendEmail({
      to: row.email,
      subject: "You're Registered! — Gathering Around the Gospel",
      html: gatheringRegistrationReceivedEmail(row),
      provider,
    });
    await recordGatheringEmailStatus(row.id, "registration", "sent", provider);
  } catch (err) {
    console.error("Gathering registration-received email failed:", err.message);
    await recordGatheringEmailStatus(row.id, "registration", "failed", provider);
  }
}

// Fixed set of cancellation reasons — each maps to its own drafted body
// rather than an admin-typed free-text note, per the user's explicit ask
// for canned reasons with matching copy. Keys are what's stored in
// gathering_registrations.cancellation_reason and what the admin panel's
// dropdown sends.
export const GATHERING_CANCELLATION_REASONS = {
  duplicate: {
    label: "Duplicate Submission",
    body: (row) => `
      <p style="margin:0 0 10px;">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0 0 10px;">We noticed you had more than one registration for Gathering Around the Gospel using the same GCash payment receipt. To keep things fair for everyone, we've cancelled this duplicate entry — your other registration is still active and doesn't need to be resubmitted.</p>
      <p style="margin:0;">If you believe this was cancelled by mistake, just reply to this email and we'll sort it out.</p>`,
  },
  cant_confirm_payment: {
    label: "Can't Confirm Payment",
    body: (row) => `
      <p style="margin:0 0 10px;">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0 0 10px;">We weren't able to verify the GCash receipt submitted with your registration for Gathering Around the Gospel, so we've had to cancel this entry.</p>
      <p style="margin:0;">If you did complete a valid payment, please reply to this email with a clearer copy of your receipt (or your GCash reference number) and we'll help sort it out. Otherwise, feel free to register again with a valid receipt.</p>`,
  },
  registrant_requested: {
    label: "Registrant Requested",
    body: (row) => `
      <p style="margin:0 0 10px;">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0;">As requested, we've cancelled your registration for Gathering Around the Gospel. We hope to see you at a future gathering!</p>`,
  },
  other: {
    label: "Other",
    body: (row) => `
      <p style="margin:0 0 10px;">Hi ${escapeHtml(row.name)},</p>
      <p style="margin:0;">Your registration for Gathering Around the Gospel has been cancelled. If you have any questions, please reach out to us.</p>`,
  },
};

export function gatheringCancellationEmail(row, reason) {
  const entry = GATHERING_CANCELLATION_REASONS[reason] || GATHERING_CANCELLATION_REASONS.other;
  return gatheringEmailShell({
    heroUrl: gatheringHeroUrl(),
    headerBg: GATHERING_HEADER_GRADIENT_RED,
    headerTitle: "Registration Cancelled",
    body: entry.body(row),
  });
}

/**
 * Cancellation email defaults to Gmail — replies are expected here ("reply
 * to this email if..."), and Gmail is a real monitored inbox in a way the
 * Resend-verified domain isn't. An admin can still override to Resend for
 * one send via the resend/retry picker in the admin panel (providerOverride)
 * — Reply-To is always set to GMAIL_USER regardless of provider, so replies
 * land in the real inbox either way.
 */
export async function sendGatheringCancellationEmail(sendEmail, row, reason, providerOverride) {
  if (!row.email) return;
  const provider = providerOverride === "resend" ? "resend" : "gmail";
  try {
    await sendEmail({
      to: row.email,
      subject: "Registration Cancelled — Gathering Around the Gospel",
      html: gatheringCancellationEmail(row, reason),
      provider,
      replyTo: process.env.GMAIL_USER,
    });
    await recordGatheringEmailStatus(row.id, "cancellation", "sent", provider);
  } catch (err) {
    console.error("Gathering cancellation email failed:", err.message);
    await recordGatheringEmailStatus(row.id, "cancellation", "failed", provider);
  }
}
