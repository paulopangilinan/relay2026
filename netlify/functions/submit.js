// netlify/functions/submit.js
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
    const { name, age, mobile, email, studentStatus, church, otherChurch, paymentReady,
            schoolIdBase64, schoolIdName, receiptBase64, receiptName } = body;

    const churchName = church === "others" ? otherChurch : church;
    const transporter = getTransporter();
    const siteUrl = process.env.SITE_URL;
    const qrUrl = `${siteUrl}/assets/images/qr/gcash-qr.png`;
    const heroUrl = `${siteUrl}/assets/images/hero-email.jpg`;
    const contactEmail = process.env.CONTACT_EMAIL || process.env.GMAIL_USER || 'ccsgmprojects@gmail.com';

    // 0. Check for duplicate email
    const { data: existing, error: dupErr } = await supabase
      .from("registrations")
      .select("id, payment_verified")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    console.log("Duplicate check — email:", email.toLowerCase().trim(), "| existing:", JSON.stringify(existing), "| error:", dupErr?.message);

    if (existing) {
      if (existing.payment_verified) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: "already_confirmed", message: "This email has already been registered and confirmed. Please contact us if you need help." }) };
      }
      return { statusCode: 409, headers, body: JSON.stringify({ error: "already_registered", message: "This email already has a pending registration. Check your inbox for payment instructions, or contact us for help." }) };
    }

    // 1. Upload school ID
    let schoolIdUrl = null;
    if (studentStatus === "student" && schoolIdBase64) {
      const ext = schoolIdName?.split(".").pop() || "jpg";
      const path = `school-ids/${Date.now()}-${name.replace(/\s+/g, "_")}.${ext}`;
      const buf = Buffer.from(schoolIdBase64, "base64");
      const { error } = await supabase.storage.from("relay-uploads").upload(path, buf, { contentType: `image/${ext}` });
      if (!error) {
        const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
        schoolIdUrl = data.publicUrl;
      }
    }

    // 2. Upload receipt
    let receiptUrl = null;
    if (paymentReady === "now" && receiptBase64) {
      const ext = receiptName?.split(".").pop() || "jpg";
      const path = `receipts/${Date.now()}-${name.replace(/\s+/g, "_")}.${ext}`;
      const buf = Buffer.from(receiptBase64, "base64");
      const { error } = await supabase.storage.from("relay-uploads").upload(path, buf, { contentType: `image/${ext}` });
      if (!error) {
        const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
        receiptUrl = data.publicUrl;
      }
    }

    // 3. Insert into DB
    const { data: reg, error: dbErr } = await supabase
      .from("registrations")
      .insert({
        name, age: parseInt(age), mobile, email,
        student_status: studentStatus,
        church: churchName,
        payment_ready: paymentReady === "now",
        school_id_url: schoolIdUrl,
        receipt_url: receiptUrl,
        payment_verified: false,
        status: paymentReady === "now" ? "payment_pending_review" : "awaiting_payment",
      })
      .select().single();

    if (dbErr) throw new Error("DB insert failed: " + dbErr.message);

    const verifyLink = `${siteUrl}/.netlify/functions/verify?id=${reg.id}`;
    const fee = studentStatus === "student" ? "PHP 3,000" : "PHP 4,500";

    // 4a. With payment
    if (paymentReady === "now") {
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Registration + Payment — ${name}`,
        html: adminPaymentEmail({ name, email, age, mobile, studentStatus, churchName, fee, receiptUrl, verifyLink, heroUrl }),
      });
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: "RELAY 2026 — We received your registration!",
        html: registrantAckEmail({ name, fee, studentStatus, churchName, heroUrl, contactEmail }),
      });
    // 4b. Pay later
    } else {
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Registration (Awaiting Payment) — ${name}`,
        html: adminAwaitingEmail({ name, email, age, mobile, studentStatus, churchName, fee, heroUrl }),
      });
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: "RELAY 2026 — Complete your registration",
        html: registrantPaymentEmail({
          name, fee, studentStatus, qrUrl, heroUrl, siteUrl,
          registrationId: reg.id,
          gcashAccountName:   process.env.GCASH_ACCOUNT_NAME,
          gcashAccountHolder: process.env.GCASH_ACCOUNT_HOLDER,
          gcashMobile:        process.env.GCASH_MOBILE,
          contactEmail,
        }),
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: reg.id }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Shared shell ──────────────────────────────────────────────────────────────
function emailShell({ heroUrl, headerBg, headerTitle, headerSub, body }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:${headerBg};padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;letter-spacing:0.02em;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .row{margin-bottom:12px;}
    .lbl{font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;}
    .val{color:#2A3D4A;font-size:14px;margin-top:3px;}
    hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
    .note{background:#FDF6E0;border-left:3px solid #E8B830;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#7A5A10;line-height:1.6;margin:16px 0;}
    .info-box{background:#EBF5FB;border-radius:10px;padding:16px 20px;font-size:13px;color:#2A3D4A;line-height:1.8;}
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
  return items.map(([l, v]) => `<div class="row"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join('');
}

// ── Admin: payment received ───────────────────────────────────────────────────
function adminPaymentEmail({ name, email, age, mobile, studentStatus, churchName, fee, receiptUrl, verifyLink, heroUrl }) {
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#2A3D4A)',
    headerTitle: 'New Registration + Payment',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      ${rows(['Name',name],['Email',email],['Mobile',mobile],['Age',age],
             ['Status', studentStatus==='student'?'Student':'Non-Student'],
             ['Church',churchName],['Fee',fee])}
      <hr>
      ${receiptUrl ? `<p style="font-size:13px;margin-bottom:16px;">📎 <a href="${receiptUrl}" style="color:#3A8BBF;font-weight:600;">View payment screenshot</a></p>` : ''}
      <div class="note">Check your GCash app to confirm payment was received, then click the button below to send the registrant their confirmation email.</div>
      <div style="text-align:center;margin-top:24px;">
        <a href="${verifyLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#2E7048;">✅ Verify Payment &amp; Confirm Registration</a>
      </div>
    `
  });
}

// ── Admin: awaiting payment ───────────────────────────────────────────────────
function adminAwaitingEmail({ name, email, age, mobile, studentStatus, churchName, fee, heroUrl }) {
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#2A3D4A)',
    headerTitle: 'New Registration (Awaiting Payment)',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      ${rows(['Name',name],['Email',email],['Mobile',mobile],['Age',age],
             ['Status', studentStatus==='student'?'Student':'Non-Student'],
             ['Church',churchName],['Fee',fee])}
      <div class="note">This registrant chose to pay later. Payment instructions have been sent to their email.</div>
    `
  });
}

// ── Registrant: acknowledgement (paid) ───────────────────────────────────────
function registrantAckEmail({ name, fee, studentStatus, churchName, heroUrl, contactEmail }) {
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#2E7048)',
    headerTitle: 'We received your registration!',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${name}</strong>, thank you for registering for RELAY 2026! 🎉</p>
      ${rows(['Church',churchName],['Status',studentStatus==='student'?'Student':'Non-Student'],['Fee',fee])}
      <hr>
      <div class="note">Your payment screenshot has been received. Our team will verify it and send you a confirmation email shortly. For questions, contact us at <a href="mailto:${contactEmail}" style="color:var(--sky);">${contactEmail}</a>.</div>
      ${studentStatus==='student' ? '<div class="note" style="margin-top:8px;">🪪 Your submitted school ID will also be reviewed to confirm your student discount.</div>' : ''}
      <div class="info-box" style="margin-top:16px;">
        <strong>📍 Location:</strong> CCT Tagaytay Retreat and Training Center<br>
        <strong>🗓 Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br>
        <strong>✝️ Theme:</strong> Living for Christ Alone
      </div>
    `
  });
}

// ── Registrant: pay later (GCash QR + upload link) ───────────────────────────
function registrantPaymentEmail({ name, fee, studentStatus, qrUrl, heroUrl, siteUrl, registrationId, gcashAccountName, gcashAccountHolder, gcashMobile, contactEmail }) {
  const uploadLink = `${siteUrl}/upload-receipt.html?id=${registrationId}`;
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#3A8BBF)',
    headerTitle: 'Complete Your Registration',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:16px;">Hi <strong>${name}</strong>, thank you for your interest in RELAY Conference Asia Pacific 2026!</p>
      <p style="font-size:14px;color:#2A3D4A;margin-bottom:20px;">To confirm your slot, scan the GCash QR below and pay <strong>${fee}</strong>, then click the button to submit your receipt.</p>

      <!-- GCash card -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
        <tr><td align="center">
          <table cellpadding="0" cellspacing="0" border="0" style="background:#0A8FD9;border-radius:16px;overflow:hidden;width:100%;max-width:360px;">
            <tr><td align="center" style="padding:0;background:#0A8FD9;line-height:0;border-radius:16px 16px 0 0;overflow:hidden;">
              <img src="${siteUrl}/assets/images/gcash-header.png" alt="GCash" width="360" style="display:block;width:100%;height:auto;border-radius:16px 16px 0 0;">
            </td></tr>
            <tr><td style="padding:0 14px 14px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F7FA;border-radius:14px;padding:24px 20px;text-align:center;">
                <tr><td align="center" style="padding-bottom:16px;">
                  <img src="${qrUrl}" alt="GCash QR" width="190" height="190" style="display:block;border-radius:10px;border:1px solid #e0e0e0;background:#fff;">
                </td></tr>
                <tr><td style="font-size:13px;color:#666;padding-bottom:14px;">Transfer fees may apply.</td></tr>
                <tr><td style="border-top:1px solid #E0E0E0;padding-top:14px;">
                  <div style="font-size:22px;font-weight:800;color:#0070E0;letter-spacing:0.04em;margin-bottom:4px;">${gcashAccountName || 'CCSGM'}</div>
                  <div style="font-size:14px;font-weight:600;color:#333;margin-bottom:8px;">${gcashAccountHolder || ''}</div>
                  <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;">
                    <span style="color:#888;">Mobile No.:</span>
                    <span style="color:#444;font-weight:600;font-family:monospace;">${gcashMobile || ''}</span>
                  </div>
                  <div style="margin-top:14px;background:#E8F4FF;border-radius:8px;padding:10px 14px;font-size:13px;color:#0070E0;text-align:center;">
                    💡 <strong>Send Money</strong> in GCash using the mobile number above
                  </div>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
      </table>

      ${rows(['Your Status', studentStatus==='student'?'Student':'Non-Student'],['Amount Due', `<strong>${fee}</strong>`])}

      ${studentStatus==='student' ? '<div class="note" style="margin-top:16px;">🪪 Your submitted school ID will also be reviewed to confirm your student discount.</div>' : ''}
      <div class="note" style="margin-top:8px;">After paying, click the button below to attach your GCash receipt screenshot and confirm your registration.</div>
      <div style="text-align:center;margin-top:20px;">
        <a href="${uploadLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:linear-gradient(135deg,#C49A1A,#E8B830);">📎 Submit Payment Receipt</a>
      </div>
      <p style="font-size:11px;color:#6B8A9A;text-align:center;margin-top:10px;">Or copy this link: ${uploadLink}</p>
    `
  });
}
