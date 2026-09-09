// netlify/lib/gathering-email.js
// Shared HTML email builders for "Gathering Around the Gospel" — used by
// submit-gathering.js (admin-notify), admin-gathering.js (manual confirm
// from the admin panel), and confirm-gathering.js (one-click email link).
// Kept in one place so the participant-facing "Payment Confirmed" email is
// always identical no matter which of the two confirm paths triggered it.

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
    provider: "resend",
  }).catch(err => console.error("Gathering payment-confirmed email failed:", err.message));
}
