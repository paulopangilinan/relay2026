// netlify/functions/verify.js
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

export const handler = async (event) => {
  const { id } = event.queryStringParameters || {};
  if (!id) return { statusCode: 400, body: "Missing ID" };

  try {
    const { data: reg, error: fetchErr } = await supabase
      .from("registrations").select("*").eq("id", id).single();

    if (fetchErr || !reg) return htmlPage("Not Found", "Registration not found.", false);
    if (reg.payment_verified) return htmlPage("Already Verified", `${reg.name}'s registration was already confirmed.`, true);

    const { error: updateErr } = await supabase
      .from("registrations")
      .update({ payment_verified: true, status: "confirmed", verified_at: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) throw new Error(updateErr.message);

    const fee = reg.student_status === "student" ? "PHP 3,000" : "PHP 4,500";
    const heroUrl = `${process.env.SITE_URL}/assets/images/hero-email.jpg`;

    await getTransporter().sendMail({
      from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
      to: reg.email,
      subject: "RELAY 2026 — You're confirmed! 🎉",
      html: confirmationEmail(reg, fee, heroUrl),
    });

    return htmlPage("Payment Verified!", `${reg.name}'s payment confirmed. A confirmation email has been sent to ${reg.email}.`, true);
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
      .badge{display:inline-block;background:${success?'#2E7048':'#C0392B'};color:#fff;border-radius:8px;padding:10px 24px;font-family:'Bebas Neue';font-size:18px;letter-spacing:0.06em;margin-top:24px;}
      .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);border-radius:16px 16px 0 0;margin:-48px -40px 32px;width:calc(100% + 80px);}
    </style></head>
    <body><div class="card">
      <div class="bar"></div>
      <div class="icon">${success?'✅':'❌'}</div>
      <h1>${title}</h1><p>${message}</p>
      <div class="badge">RELAY 2026</div>
    </div></body></html>`,
  };
}

function confirmationEmail(reg, fee, heroUrl) {
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
      <div class="row"><div class="lbl">Status</div><div class="val">${reg.student_status === "student" ? "Student" : "Non-Student"}</div></div>
      <div class="row"><div class="lbl">Church</div><div class="val">${reg.church}</div></div>
      <div class="row"><div class="lbl">Amount Paid</div><div class="val">${fee}</div></div>
      <hr>
      <div class="info-box">
        <strong>📍 Location:</strong> CCT Tagaytay Retreat and Training Center<br>
        <strong>🗓 Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br>
        <strong>✝️ Theme:</strong> Living for Christ Alone
      </div>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}
