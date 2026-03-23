// netlify/functions/submit-receipt.js
// Called from upload-receipt.html when a pay-later registrant submits their GCash receipt

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
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const { id, receiptBase64, receiptName } = JSON.parse(event.body);
    if (!id || !receiptBase64) throw new Error("Missing required fields");

    // Fetch registration
    const { data: reg, error: fetchErr } = await supabase
      .from("registrations")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !reg) throw new Error("Registration not found");
    if (reg.payment_verified) throw new Error("Already verified");

    // Upload receipt to Supabase storage
    const ext  = receiptName?.split(".").pop() || "jpg";
    const path = `receipts/${Date.now()}-${reg.name.replace(/\s+/g, "_")}.${ext}`;
    const buf  = Buffer.from(receiptBase64, "base64");
    const { error: upErr } = await supabase.storage
      .from("relay-uploads")
      .upload(path, buf, { contentType: `image/${ext}` });

    let receiptUrl = null;
    if (!upErr) {
      const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
      receiptUrl = data.publicUrl;
    }

    // Update registration status
    await supabase
      .from("registrations")
      .update({ payment_ready: true, receipt_url: receiptUrl, status: "payment_pending_review" })
      .eq("id", id);

    // Notify admin
    const siteUrl  = process.env.SITE_URL;
    const heroUrl  = `${siteUrl}/assets/images/hero-email.jpg`;
    const verifyLink = `${siteUrl}/.netlify/functions/verify?id=${id}`;
    const fee = reg.student_status === "student" ? "PHP 3,000" : "PHP 4,500";

    await getTransporter().sendMail({
      from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
      to:      process.env.ADMIN_EMAIL,
      subject: `💰 Payment Receipt Submitted — ${reg.name}`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
        .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
        .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);}
        .hero-img{width:100%;display:block;}
        .header{background:linear-gradient(135deg,#1C2B38,#2A3D4A);padding:28px 32px;text-align:center;}
        .header h1{color:#fff;font-size:22px;margin:0;}.header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
        .body{padding:32px;}
        .row{margin-bottom:12px;}.lbl{font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;}.val{color:#2A3D4A;font-size:14px;margin-top:3px;}
        hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
        .note{background:#FDF6E0;border-left:3px solid #E8B830;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#7A5A10;margin:16px 0;}
        .cta{display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#2E7048;}
        .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
      </style></head><body><div class="wrap">
        <div class="bar"></div>
        <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
        <div class="header"><h1>💰 Payment Receipt Submitted</h1><p>RELAY Conference Asia Pacific 2026</p></div>
        <div class="body">
          <div class="row"><div class="lbl">Name</div><div class="val">${reg.name}</div></div>
          <div class="row"><div class="lbl">Email</div><div class="val">${reg.email}</div></div>
          <div class="row"><div class="lbl">Church</div><div class="val">${reg.church}</div></div>
          <div class="row"><div class="lbl">Status</div><div class="val">${reg.student_status === "student" ? "Student" : "Non-Student"}</div></div>
          <div class="row"><div class="lbl">Fee</div><div class="val">${fee}</div></div>
          <hr>
          ${receiptUrl ? `<p style="font-size:13px;margin-bottom:16px;">📎 <a href="${receiptUrl}" style="color:#3A8BBF;font-weight:600;">View receipt screenshot</a></p>` : ""}
          <div class="note">This registrant previously chose to pay later and has now submitted their GCash receipt. Verify the payment and click below to confirm.</div>
          <div style="text-align:center;margin-top:24px;">
            <a href="${verifyLink}" class="cta">✅ Verify Payment &amp; Confirm Registration</a>
          </div>
        </div>
        <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific</div>
      </div></body></html>`,
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
