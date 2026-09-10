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
// green for "confirmed / pay-at-venue".
export const GATHERING_HEADER_GRADIENT_BLUE  = "linear-gradient(135deg,#1C2B38,#3A8BBF)";
export const GATHERING_HEADER_GRADIENT_GREEN = "linear-gradient(135deg,#1C2B38,#2E7048)";

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

export async function sendGatheringPaymentConfirmedEmail(sendEmail, row) {
  if (!row.email) return;
  return sendEmail({
    to: row.email,
    subject: "Payment Confirmed — Gathering Around the Gospel",
    html: gatheringPaymentConfirmedEmail(row),
    provider: await getGatheringEmailProvider(),
  }).catch(err => console.error("Gathering payment-confirmed email failed:", err.message));
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

export async function sendGatheringRegistrationReceivedEmail(sendEmail, row) {
  if (!row.email) return;
  return sendEmail({
    to: row.email,
    subject: "You're Registered! — Gathering Around the Gospel",
    html: gatheringRegistrationReceivedEmail(row),
    provider: await getGatheringEmailProvider(),
  }).catch(err => console.error("Gathering registration-received email failed:", err.message));
}
