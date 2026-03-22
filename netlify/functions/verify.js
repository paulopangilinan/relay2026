// netlify/functions/verify.js
// Admin clicks "Verify Payment" link → marks DB record → emails registrant confirmation

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

export const handler = async (event) => {
  const { id } = event.queryStringParameters || {};
  if (!id) return { statusCode: 400, body: "Missing registration ID" };

  try {
    const { data: reg, error: fetchErr } = await supabase
      .from("registrations")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !reg) return htmlPage("Not Found", "Registration not found.", false);
    if (reg.payment_verified) return htmlPage("Already Verified", `${reg.name}'s registration was already verified.`, true);

    const { error: updateErr } = await supabase
      .from("registrations")
      .update({ payment_verified: true, status: "confirmed", verified_at: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) throw new Error(updateErr.message);

    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
      to: reg.email,
      subject: "RELAY 2026 — You're confirmed!",
      html: confirmationEmail(reg),
    });

    return htmlPage("Payment Verified!", `${reg.name}'s payment has been verified. A confirmation email has been sent to ${reg.email}.`, true);
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
    <style>
      body{font-family:Arial,sans-serif;background:#f2f5f8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .card{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.1);}
      h1{font-size:22px;color:#1C2B38;margin-bottom:12px;}
      p{font-size:14px;color:#6B8A9A;line-height:1.6;}
      .badge{display:inline-block;background:${success ? "#2E7048" : "#C0392B"};color:#fff;border-radius:8px;padding:8px 20px;font-size:14px;font-weight:700;margin-top:20px;}
    </style></head>
    <body><div class="card">
      <div style="font-size:52px;margin-bottom:16px;">${success ? "✅" : "❌"}</div>
      <h1>${title}</h1><p>${message}</p>
      <div class="badge">RELAY 2026</div>
    </div></body></html>`,
  };
}

function confirmationEmail(reg) {
  const fee = reg.student_status === "student" ? "PHP 3,000" : "PHP 4,500";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#f2f5f8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);}
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
    <div class="header"><h1>You're confirmed!</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${reg.name}</strong>, your payment has been verified and your registration is confirmed. We can't wait to see you in Tagaytay!</p>
      <div class="highlight"><h2>Registration Confirmed</h2><p>Your slot is reserved for RELAY 2026</p></div>
      <div class="row"><div class="lbl">Name</div><div class="val">${reg.name}</div></div>
      <div class="row"><div class="lbl">Status</div><div class="val">${reg.student_status === "student" ? "Student" : "Non-Student"}</div></div>
      <div class="row"><div class="lbl">Church</div><div class="val">${reg.church}</div></div>
      <div class="row"><div class="lbl">Amount Paid</div><div class="val">${fee}</div></div>
      <hr>
      <div class="info">
        <strong>Location:</strong> CCT Tagaytay Retreat and Training Center<br>
        <strong>Date:</strong> September 23-26, 2026 (4 Days, 3 Nights)<br>
        <strong>Theme:</strong> Living for Christ Alone
      </div>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}
