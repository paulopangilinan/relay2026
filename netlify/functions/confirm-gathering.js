// netlify/functions/confirm-gathering.js
// Public, unauthenticated one-click "Confirm Payment" link for Gathering
// Around the Gospel GCash registrations — reached from the CTA button in
// the admin-notify email (see submit-gathering.js). Mirrors verify.js's
// pattern for the main RELAY registration flow: a signed admin JWT in the
// query string stands in for a login, so an admin can confirm a payment
// straight from their inbox without opening the admin panel.
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import { sendEmail } from "../lib/mailer.js";
import { sendGatheringPaymentConfirmedEmail } from "../lib/gathering-email.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "relay2026secret";

export const handler = async (event) => {
  const { id, atoken } = event.queryStringParameters || {};
  if (!id) return htmlPage("Missing ID", "No registration ID was provided.", false);

  // Decode admin token — fallback to "email-link" if missing or expired,
  // same behavior as verify.js. The token itself is what stands in for
  // authorization here since this is a public GET endpoint.
  let verifiedBy = "email-link";
  if (atoken) {
    try {
      const decoded = jwt.verify(atoken, JWT_SECRET);
      if (decoded?.email) verifiedBy = decoded.email;
    } catch {
      verifiedBy = "email-link";
    }
  }

  try {
    const { data: row, error: fetchErr } = await supabase
      .from("gathering_registrations").select("*").eq("id", id).single();
    if (fetchErr || !row) return htmlPage("Not Found", "Registration not found.", false);

    if (row.payment_method !== "gcash") {
      return htmlPage("Not Applicable", "This is a Pay at Venue registration — those are only confirmed at check-in, not from this link.", false);
    }
    if (row.payment_status === "confirmed") {
      return htmlPage("Already Confirmed", `${row.name}'s payment was already confirmed.`, true);
    }

    const { data: updated, error } = await supabase
      .from("gathering_registrations")
      .update({ payment_status: "confirmed", verified_at: new Date().toISOString(), verified_by: verifiedBy })
      .eq("id", id).select().single();
    if (error) throw error;

    await sendGatheringPaymentConfirmedEmail(sendEmail, updated);

    return htmlPage("Payment Confirmed!", `${updated.name}'s GCash payment is confirmed. A confirmation email has been sent to ${updated.email}.`, true);
  } catch (err) {
    console.error(err);
    return htmlPage("Error", "Something went wrong: " + err.message, false);
  }
};

function htmlPage(title, message, success) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'DM Sans',Arial,sans-serif;background:#F2F5F8;display:flex;align-items:center;justify-content:center;min-height:100vh;}
      .card{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:420px;width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.1);}
      .icon{font-size:52px;margin-bottom:16px;}
      h1{font-family:'Bebas Neue';font-size:28px;color:#1C2B38;margin-bottom:12px;letter-spacing:0.04em;}
      p{font-size:14px;color:#6B8A9A;line-height:1.6;}
      .badge{display:inline-block;background:${success ? "#2E7048" : "#C0392B"};color:#fff;border-radius:8px;padding:10px 24px;font-family:'Bebas Neue';font-size:18px;letter-spacing:0.06em;margin-top:24px;}
      .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);border-radius:16px 16px 0 0;margin:-48px -40px 32px;width:calc(100% + 80px);}
    </style></head>
    <body><div class="card">
      <div class="bar"></div>
      <div class="icon">${success ? "✅" : "❌"}</div>
      <h1>${title}</h1><p>${message}</p>
      <div class="badge">GATHERING</div>
    </div></body></html>`,
  };
}
