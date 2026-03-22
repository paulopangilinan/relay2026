// netlify/functions/submit.js
// Handles form submission: saves to Supabase, sends emails via Gmail (Nodemailer)

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
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = JSON.parse(event.body);
    const {
      name, age, mobile, email,
      studentStatus, church, otherChurch,
      paymentReady,
      schoolIdBase64, schoolIdName,
      receiptBase64, receiptName,
    } = body;

    const churchName = church === "others" ? otherChurch : church;
    const transporter = getTransporter();

    // 1. Upload school ID
    let schoolIdUrl = null;
    if (studentStatus === "student" && schoolIdBase64) {
      const ext = schoolIdName?.split(".").pop() || "jpg";
      const path = `school-ids/${Date.now()}-${name.replace(/\s+/g, "_")}.${ext}`;
      const buf = Buffer.from(schoolIdBase64, "base64");
      const { error: upErr } = await supabase.storage
        .from("relay-uploads")
        .upload(path, buf, { contentType: `image/${ext}` });
      if (!upErr) {
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
      const { error: upErr } = await supabase.storage
        .from("relay-uploads")
        .upload(path, buf, { contentType: `image/${ext}` });
      if (!upErr) {
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
      .select()
      .single();

    if (dbErr) throw new Error("DB insert failed: " + dbErr.message);

    const siteUrl = process.env.SITE_URL;
    const verifyLink = `${siteUrl}/.netlify/functions/verify?id=${reg.id}`;
    const fee = studentStatus === "student" ? "PHP 3,000" : "PHP 4,500";

    // 4a. With payment
    if (paymentReady === "now") {
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Registration + Payment — ${name}`,
        html: adminPaymentEmail({ name, email, age, mobile, studentStatus, churchName, fee, receiptUrl, verifyLink }),
      });
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: "RELAY 2026 — We received your registration!",
        html: registrantAckEmail({ name, fee, studentStatus, churchName }),
      });
    // 4b. No payment yet
    } else {
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Registration (Awaiting Payment) — ${name}`,
        html: adminAwaitingEmail({ name, email, age, mobile, studentStatus, churchName, fee }),
      });
      await transporter.sendMail({
        from: `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: "RELAY 2026 — Complete your registration",
        html: registrantPaymentEmail({ name, fee, studentStatus }),
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: reg.id }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function emailShell(content) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#f2f5f8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .header{background:linear-gradient(135deg,#1C2B38 0%,#2A3D4A 100%);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:24px;margin:0;}
    .header p{color:rgba(255,255,255,0.6);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .row{margin-bottom:12px;font-size:14px;}
    .lbl{font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:11px;letter-spacing:0.06em;}
    .val{color:#2A3D4A;margin-top:2px;}
    hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
    .cta{display:inline-block;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;color:#fff !important;background:#2E7048;}
    .note{background:#FDF6E0;border-left:3px solid #E8B830;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#7A5A10;margin:16px 0;}
    .footer{background:#f7fafb;padding:18px 32px;text-align:center;font-size:12px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">${content}</div></body></html>`;
}

function adminPaymentEmail({ name, email, age, mobile, studentStatus, churchName, fee, receiptUrl, verifyLink }) {
  return emailShell(`
    <div class="header"><h1>New Registration + Payment</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <div class="row"><div class="lbl">Name</div><div class="val">${name}</div></div>
      <div class="row"><div class="lbl">Email</div><div class="val">${email}</div></div>
      <div class="row"><div class="lbl">Mobile</div><div class="val">${mobile}</div></div>
      <div class="row"><div class="lbl">Age</div><div class="val">${age}</div></div>
      <div class="row"><div class="lbl">Status</div><div class="val">${studentStatus === "student" ? "Student" : "Non-Student"}</div></div>
      <div class="row"><div class="lbl">Church</div><div class="val">${churchName}</div></div>
      <div class="row"><div class="lbl">Fee</div><div class="val">${fee}</div></div>
      <hr>
      ${receiptUrl ? `<p style="font-size:13px;margin-bottom:16px;">Payment screenshot: <a href="${receiptUrl}" style="color:#3A8BBF;">View here</a></p>` : ""}
      <div class="note">Check your BPI/GCash app to confirm payment was received, then click below to send the registrant their confirmation email.</div>
      <div style="text-align:center;margin-top:24px;">
        <a href="${verifyLink}" class="cta">Verify Payment and Confirm Registration</a>
      </div>
    </div>
    <div class="footer">RELAY 2026 · CCT Tagaytay · Sept 23-26, 2026</div>
  `);
}

function adminAwaitingEmail({ name, email, age, mobile, studentStatus, churchName, fee }) {
  return emailShell(`
    <div class="header"><h1>New Registration (Awaiting Payment)</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <div class="row"><div class="lbl">Name</div><div class="val">${name}</div></div>
      <div class="row"><div class="lbl">Email</div><div class="val">${email}</div></div>
      <div class="row"><div class="lbl">Mobile</div><div class="val">${mobile}</div></div>
      <div class="row"><div class="lbl">Age</div><div class="val">${age}</div></div>
      <div class="row"><div class="lbl">Status</div><div class="val">${studentStatus === "student" ? "Student" : "Non-Student"}</div></div>
      <div class="row"><div class="lbl">Church</div><div class="val">${churchName}</div></div>
      <div class="row"><div class="lbl">Fee</div><div class="val">${fee}</div></div>
      <div class="note">This registrant chose to pay later. Payment instructions have been sent to their email.</div>
    </div>
    <div class="footer">RELAY 2026 · CCT Tagaytay · Sept 23-26, 2026</div>
  `);
}

function registrantAckEmail({ name, fee, studentStatus, churchName }) {
  return emailShell(`
    <div class="header"><h1>We received your registration!</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${name}</strong>, thank you for registering for RELAY 2026!</p>
      <div class="row"><div class="lbl">Church</div><div class="val">${churchName}</div></div>
      <div class="row"><div class="lbl">Status</div><div class="val">${studentStatus === "student" ? "Student" : "Non-Student"}</div></div>
      <div class="row"><div class="lbl">Fee</div><div class="val">${fee}</div></div>
      <hr>
      <div class="note">Your payment screenshot has been received. Our team will verify it shortly and send you a confirmation email. For questions, reply to this email.</div>
      <p style="font-size:13px;color:#6B8A9A;margin-top:20px;">Location: CCT Tagaytay Retreat and Training Center<br>Date: September 23-26, 2026</p>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific</div>
  `);
}

function registrantPaymentEmail({ name, fee, studentStatus }) {
  return emailShell(`
    <div class="header"><h1>Complete your registration</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:16px;">Hi <strong>${name}</strong>, thank you for your interest in RELAY Conference Asia Pacific 2026!</p>
      <p style="font-size:14px;color:#2A3D4A;margin-bottom:20px;">To confirm your slot, please send your payment of <strong>${fee}</strong> to:</p>
      <div style="background:#EBF5FB;border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;">
        <p style="font-size:15px;font-weight:700;color:#3A8BBF;margin-bottom:8px;">BPI Account - CCSGM</p>
        <p style="font-size:13px;color:#2A3D4A;margin-bottom:4px;"><strong>Account Name:</strong> [Your Account Name]</p>
        <p style="font-size:13px;color:#2A3D4A;"><strong>Account Number:</strong> [Your BPI Account Number]</p>
      </div>
      <div class="note">After paying, reply to this email with a screenshot of your transaction, or go back to the registration form and resubmit with your receipt attached.</div>
      <div class="row" style="margin-top:16px;"><div class="lbl">Your Status</div><div class="val">${studentStatus === "student" ? "Student" : "Non-Student"}</div></div>
      <div class="row"><div class="lbl">Amount Due</div><div class="val"><strong>${fee}</strong></div></div>
    </div>
    <div class="footer">RELAY 2026 · CCT Tagaytay · Sept 23-26, 2026</div>
  `);
}
