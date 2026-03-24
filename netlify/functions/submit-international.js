// netlify/functions/submit-international.js
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
    const body = JSON.parse(event.body);
    const { name, age, mobile, email, country, church, allergens, allergenOther, receiptBase64, receiptName } = body;

    const transporter = getTransporter();
    const siteUrl     = process.env.SITE_URL;
    const heroUrl     = `${siteUrl}/assets/images/hero-email.jpg`;

    // 0. Check for duplicate email
    const { data: existing } = await supabase
      .from("registrations")
      .select("id, payment_verified")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (existing) {
      if (existing.payment_verified) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: "already_confirmed", message: "This email has already been registered and confirmed. Please contact us if you need help." }) };
      }
      return { statusCode: 409, headers, body: JSON.stringify({ error: "already_registered", message: "This email already has a pending registration. Check your inbox for payment instructions, or contact us for help." }) };
    }

    // 1. Upload receipt
    let receiptUrl = null;
    if (receiptBase64) {
      const ext  = receiptName?.split(".").pop() || "jpg";
      const path = `receipts-intl/${Date.now()}-${name.replace(/\s+/g, "_")}.${ext}`;
      const buf  = Buffer.from(receiptBase64, "base64");
      const { error } = await supabase.storage.from("relay-uploads").upload(path, buf, { contentType: `image/${ext}` });
      if (!error) {
        const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
        receiptUrl = data.publicUrl;
      }
    }

    // 2. Insert into DB
    const allergenSummary = [
      ...(allergens || []),
      ...(allergenOther ? [`Other: ${allergenOther}`] : []),
    ].join(", ") || null;

    const { data: reg, error: dbErr } = await supabase
      .from("registrations")
      .insert({
        name, age: parseInt(age), mobile, email,
        registrant_type: "international",
        country,
        church,
        allergens: allergenSummary,
        student_status: null,
        payment_ready: true,
        receipt_url: receiptUrl,
        payment_verified: false,
        status: "payment_pending_review",
      })
      .select().single();

    if (dbErr) throw new Error("DB insert failed: " + dbErr.message);

    const verifyLink = `${siteUrl}/.netlify/functions/verify?id=${reg.id}`;
    const bpiName    = process.env.BPI_ACCOUNT_NAME   || "[Account Name]";
    const bpiNumber  = process.env.BPI_ACCOUNT_NUMBER || "[Account Number]";
    const bpiType    = process.env.BPI_ACCOUNT_TYPE   || "[Account Type]";

    // 3. Email admin
    await transporter.sendMail({
      from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
      to:      process.env.ADMIN_EMAIL,
      subject: `🌏 New International Registration + Payment — ${name} (${country})`,
      html:    adminEmail({ name, email, mobile, age, country, church, allergenSummary, receiptUrl, verifyLink, heroUrl }),
    });

    // 4. Email registrant
    await transporter.sendMail({
      from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: "RELAY 2026 — We received your international registration!",
      html:    registrantEmail({ name, country, church, allergenSummary, bpiName, bpiNumber, bpiType, heroUrl }),
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: reg.id }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Email shell (matches local form style) ────────────────────────────────────
function emailShell({ heroUrl, headerBg, headerTitle, headerSub, body }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:${headerBg};padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .row{margin-bottom:12px;}
    .lbl{font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;}
    .val{color:#2A3D4A;font-size:14px;margin-top:3px;}
    hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
    .note{background:#FDF6E0;border-left:3px solid #E8B830;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#7A5A10;line-height:1.6;margin:16px 0;}
    .bpi-box{background:#EAF5EE;border-radius:10px;padding:16px 20px;margin:16px 0;}
    .bpi-box h4{font-size:12px;font-weight:700;color:#2E7048;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;}
    .bpi-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #D0EADA;font-size:13px;}
    .bpi-row:last-child{border-bottom:none;}
    .bpi-lbl{color:#6B8A9A;flex-shrink:0;min-width:110px;} .bpi-val{color:#2A3D4A;font-weight:600;text-align:right;}
    .info-box{background:#EBF5FB;border-radius:10px;padding:16px 20px;font-size:13px;color:#2A3D4A;line-height:1.8;}
    .cta{display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#2E7048;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>${headerTitle}</h1><p>${headerSub}</p></div>
    <div class="body">${body}</div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · CCT Tagaytay · Sept 23–26, 2026</div>
  </div></body></html>`;
}

function rows(...items) {
  return items.filter(([,v]) => v).map(([l,v]) =>
    `<div class="row"><div class="lbl">${l}</div><div class="val">${v}</div></div>`
  ).join('');
}

function adminEmail({ name, email, mobile, age, country, church, allergenSummary, receiptUrl, verifyLink, heroUrl }) {
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#2A3D4A)',
    headerTitle: '🌏 New International Registration + Payment',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      ${rows(['Name',name],['Email',email],['Mobile',mobile],['Age',age],
             ['Country',country],['Church',church],['Fee','USD $300'],
             ['Dietary / Allergens', allergenSummary || 'None specified'])}
      <hr>
      ${receiptUrl ? `<p style="font-size:13px;margin-bottom:16px;">📎 <a href="${receiptUrl}" style="color:#3A8BBF;font-weight:600;">View payment receipt</a></p>` : ''}
      <div class="note">Verify the BPI transfer in your banking app, then click below to confirm this registration.</div>
      <div style="text-align:center;margin-top:24px;">
        <a href="${verifyLink}" class="cta">✅ Verify Payment &amp; Confirm Registration</a>
      </div>
    `
  });
}

function registrantEmail({ name, country, church, allergenSummary, bpiName, bpiNumber, bpiType, heroUrl }) {
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#3A8BBF)',
    headerTitle: 'We received your registration!',
    headerSub: 'RELAY Conference Asia Pacific 2026 · International',
    body: `
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${name}</strong>, thank you for registering for RELAY 2026! We're excited to welcome you from <strong>${country}</strong>. 🎉</p>
      ${rows(['Church',church],['Country',country],['Conference Fee','USD $300'],
             ['Dietary Notes', allergenSummary || 'None specified'])}
      <hr>
      <div class="bpi-box">
        <h4>🏦 BPI Bank Transfer Details</h4>
        <div class="bpi-row"><span class="bpi-lbl">Account Name</span><span class="bpi-val">${bpiName}</span></div>
        <div class="bpi-row"><span class="bpi-lbl">Account Number</span><span class="bpi-val">${bpiNumber}</span></div>
        <div class="bpi-row"><span class="bpi-lbl">Account Type</span><span class="bpi-val">${bpiType}</span></div>
        <div class="bpi-row"><span class="bpi-lbl">Amount</span><span class="bpi-val" style="color:#3A8BBF;">USD $300</span></div>
      </div>
      <div class="note">Please use your full name as the payment reference. Our team will verify your transfer and send a confirmation email once your slot is confirmed. For questions, reply to this email.</div>
      <div class="info-box" style="margin-top:16px;">
        <strong>📍 Location:</strong> CCT Tagaytay Retreat and Training Center, Philippines<br>
        <strong>🗓 Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br>
        <strong>✝️ Theme:</strong> Living for Christ Alone
      </div>
    `
  });
}
