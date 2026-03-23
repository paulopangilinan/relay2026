// netlify/functions/admin-data.js
// GET  → returns registrations + stats (filtered by type: local | international)
// POST → manual status override

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function authCheck(event) {
  const auth = event.headers.authorization || "";
  return auth.replace("Bearer ", "") === process.env.ADMIN_PASSWORD;
}

export const handler = async (event) => {
  if (!authCheck(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  // ── POST: manual confirm ───────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    try {
      const { id, action } = JSON.parse(event.body);
      const { data: reg, error: fetchErr } = await supabase.from("registrations").select("*").eq("id", id).single();
      if (fetchErr || !reg) throw new Error("Registration not found");

      await supabase.from("registrations")
        .update({ payment_verified: true, status: "confirmed", verified_at: new Date().toISOString() })
        .eq("id", id);

      if (action === "confirm") {
        const isIntl = reg.registrant_type === "international";
        const fee    = isIntl ? "USD $300" : (reg.student_status === "student" ? "PHP 3,000" : "PHP 4,500");
        const heroUrl = `${process.env.SITE_URL}/assets/images/hero-email.jpg`;
        await getTransporter().sendMail({
          from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
          to:      reg.email,
          subject: "RELAY 2026 — You're confirmed! 🎉",
          html:    confirmationEmail(reg, fee, heroUrl),
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── GET: fetch registrations ───────────────────────────────────────────
  try {
    const { data, error } = await supabase.from("registrations").select("*").order("created_at", { ascending: false });
    if (error) throw error;

    function statsFor(subset) {
      const confirmed     = subset.filter(r => r.payment_verified);
      const pendingReview = subset.filter(r => r.payment_ready && !r.payment_verified);
      const awaitingPay   = subset.filter(r => !r.payment_ready && !r.payment_verified);
      return {
        total:             subset.length,
        confirmed:         confirmed.length,
        pending_review:    pendingReview.length,
        awaiting_payment:  awaitingPay.length,
        confirmed_revenue: confirmed.reduce((s, r) => s + feeFor(r), 0),
        pending_revenue:   pendingReview.reduce((s, r) => s + feeFor(r), 0),
        by_church:         subset.reduce((acc, r) => { acc[r.church] = (acc[r.church]||0)+1; return acc; }, {}),
        // Local-only
        students:          subset.filter(r => r.student_status === "student").length,
        non_students:      subset.filter(r => r.student_status === "non-student").length,
        // Intl-only
        by_country:        subset.reduce((acc, r) => { if (r.country) acc[r.country] = (acc[r.country]||0)+1; return acc; }, {}),
      };
    }

    const local = data.filter(r => r.registrant_type !== "international");
    const intl  = data.filter(r => r.registrant_type === "international");

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        local:         local,
        international: intl,
        stats_local:   statsFor(local),
        stats_intl:    statsFor(intl),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function feeFor(r) {
  if (r.registrant_type === "international") return 300; // USD — kept separate in display
  return r.student_status === "student" ? 3000 : 4500;
}

function confirmationEmail(reg, fee, heroUrl) {
  const isIntl = reg.registrant_type === "international";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#2E7048);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .highlight{background:#EAF5EE;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px;}
    .highlight h2{color:#2E7048;font-size:20px;margin:0 0 4px;}
    .highlight p{color:#4BAE6A;font-size:13px;margin:0;}
    .row{margin-bottom:12px;}
    .lbl{font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;}
    .val{color:#2A3D4A;font-size:14px;margin-top:3px;}
    hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
    .info-box{background:#EBF5FB;border-radius:10px;padding:16px 20px;font-size:13px;color:#2A3D4A;line-height:1.8;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>You're confirmed! 🎉</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${reg.name}</strong>, your payment has been verified and your registration is confirmed. We can't wait to see you in Tagaytay!</p>
      <div class="highlight"><h2>Registration Confirmed ✅</h2><p>Your slot is reserved for RELAY 2026</p></div>
      <div class="row"><div class="lbl">Name</div><div class="val">${reg.name}</div></div>
      ${isIntl ? `<div class="row"><div class="lbl">Country</div><div class="val">${reg.country}</div></div>` : `<div class="row"><div class="lbl">Status</div><div class="val">${reg.student_status === "student" ? "Student" : "Non-Student"}</div></div>`}
      <div class="row"><div class="lbl">Church</div><div class="val">${reg.church}</div></div>
      <div class="row"><div class="lbl">Amount Paid</div><div class="val">${fee}</div></div>
      <hr>
      <div class="info-box">
        <strong>📍 Location:</strong> CCT Tagaytay Retreat and Training Center, Philippines<br>
        <strong>🗓 Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br>
        <strong>✝️ Theme:</strong> Living for Christ Alone
      </div>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}
