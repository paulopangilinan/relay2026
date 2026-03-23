// netlify/functions/admin-data.js
// GET  → returns all registrations + stats
// POST → manual status override (mark as confirmed/paid)

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

function authCheck(event) {
  const auth = event.headers.authorization || "";
  return auth.replace("Bearer ", "") === process.env.ADMIN_PASSWORD;
}

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  if (!authCheck(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  // ── POST: manual override ─────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    try {
      const { id, action } = JSON.parse(event.body);
      // action: "confirm" = mark as paid + send confirmation email

      const { data: reg, error: fetchErr } = await supabase
        .from("registrations")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr || !reg) throw new Error("Registration not found");

      const { error: updateErr } = await supabase
        .from("registrations")
        .update({
          payment_verified: true,
          status: "confirmed",
          verified_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateErr) throw new Error(updateErr.message);

      // Send confirmation email to registrant
      if (action === "confirm") {
        const transporter = getTransporter();
        const fee = reg.student_status === "student" ? "PHP 3,000" : "PHP 4,500";
        await transporter.sendMail({
          from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
          to: reg.email,
          subject: "RELAY 2026 — You're confirmed!",
          html: confirmationEmail(reg, fee),
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── GET: fetch all registrations + stats ──────────────────────────────
  try {
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const confirmed     = data.filter(r => r.payment_verified);
    const pendingReview = data.filter(r => r.payment_ready && !r.payment_verified);
    const awaitingPay   = data.filter(r => !r.payment_ready && !r.payment_verified);
    const students      = data.filter(r => r.student_status === "student");
    const nonStudents   = data.filter(r => r.student_status === "non-student");

    // Revenue
    const paidStudents    = confirmed.filter(r => r.student_status === "student").length;
    const paidNonStudents = confirmed.filter(r => r.student_status === "non-student").length;
    const confirmedRevenue = (paidStudents * 3000) + (paidNonStudents * 4500);

    const pendStudents    = pendingReview.filter(r => r.student_status === "student").length;
    const pendNonStudents = pendingReview.filter(r => r.student_status === "non-student").length;
    const pendingRevenue  = (pendStudents * 3000) + (pendNonStudents * 4500);

    const stats = {
      total: data.length,
      confirmed: confirmed.length,
      pending_review: pendingReview.length,
      awaiting_payment: awaitingPay.length,
      students: students.length,
      non_students: nonStudents.length,
      confirmed_revenue: confirmedRevenue,
      pending_revenue: pendingRevenue,
      by_church: data.reduce((acc, r) => {
        acc[r.church] = (acc[r.church] || 0) + 1;
        return acc;
      }, {}),
    };

    return { statusCode: 200, headers, body: JSON.stringify({ registrations: data, stats }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function confirmationEmail(reg, fee) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#f2f5f8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);}
    .hero img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#2E7048);padding:32px;text-align:center;}
    .header h1{color:#fff;font-size:24px;margin:0;}
    .header p{color:rgba(255,255,255,0.7);font-size:13px;margin:8px 0 0;}
    .body{padding:32px;}
    .row{margin-bottom:12px;font-size:14px;}
    .lbl{font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:11px;letter-spacing:0.06em;}
    .val{color:#2A3D4A;margin-top:2px;}
    hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
    .highlight{background:#EAF5EE;border-radius:10px;padding:20px;text-align:center;margin:20px 0;}
    .highlight h2{color:#2E7048;font-size:20px;margin:0 0 6px;}
    .highlight p{color:#4BAE6A;font-size:13px;margin:0;}
    .info{background:#EBF5FB;border-radius:8px;padding:14px 16px;font-size:13px;color:#2A3D4A;line-height:1.7;}
    .footer{background:#f7fafb;padding:18px 32px;text-align:center;font-size:12px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <div class="hero"><img src="${process.env.SITE_URL}/assets/images/hero-email.jpg" alt="RELAY 2026"></div>
    <div class="header"><h1>You're confirmed!</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${reg.name}</strong>, your payment has been verified and your registration is confirmed. We can't wait to see you in Tagaytay!</p>
      <div class="highlight"><h2>Registration Confirmed ✅</h2><p>Your slot is reserved for RELAY 2026</p></div>
      <div class="row"><div class="lbl">Name</div><div class="val">${reg.name}</div></div>
      <div class="row"><div class="lbl">Status</div><div class="val">${reg.student_status === "student" ? "Student" : "Non-Student"}</div></div>
      <div class="row"><div class="lbl">Church</div><div class="val">${reg.church}</div></div>
      <div class="row"><div class="lbl">Amount Paid</div><div class="val">${fee}</div></div>
      <hr>
      <div class="info"><strong>Location:</strong> CCT Tagaytay Retreat and Training Center<br><strong>Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br><strong>Theme:</strong> Living for Christ Alone</div>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}
