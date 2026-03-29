// netlify/functions/submit-receipt.js
import jwt from 'jsonwebtoken';
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";


async function getAdminEmails(supabase, permission) {
  const { data } = await supabase.from('admins').select('email, name, permissions, force_password_change');
  return (data || []).filter(a => a.permissions?.[permission]).map(a => a.email);
}
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
    const { id, group_id, receiptBase64, receiptName } = JSON.parse(event.body);
    if (!id || !receiptBase64) throw new Error("Missing required fields");

    // Fetch primary registration
    const { data: reg, error: fetchErr } = await supabase
      .from("registrations").select("*").eq("id", id).single();
    if (fetchErr || !reg) throw new Error("Registration not found");
    if (reg.payment_verified) throw new Error("Already verified");

    // Upload receipt
    const ext  = receiptName?.split(".").pop() || "jpg";
    const path = `receipts/${Date.now()}-${reg.name.replace(/\s+/g, "_")}.${ext}`;
    const buf  = Buffer.from(receiptBase64, "base64");
    const { error: upErr } = await supabase.storage
      .from("relay-uploads").upload(path, buf, { contentType: `image/${ext}` });

    let receiptUrl = null;
    if (!upErr) {
      const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
      receiptUrl = data.publicUrl;
    }

    // Update all rows in group, or just the single row
    if (group_id) {
      await supabase.from("registrations")
        .update({ payment_ready: true, receipt_url: receiptUrl, status: "payment_pending_review" })
        .eq("group_id", group_id);
    } else {
      await supabase.from("registrations")
        .update({ payment_ready: true, receipt_url: receiptUrl, status: "payment_pending_review" })
        .eq("id", id);
    }

    // Fetch all group members for email info
    let allMembers = [reg];
    if (group_id) {
      const { data: members } = await supabase.from("registrations")
        .select("*").eq("group_id", group_id);
      if (members) allMembers = members;
    }

    const isGroup    = allMembers.length > 1;
    const totalAmount = allMembers.reduce((s, r) => s + (r.student_status === "student" ? 3000 : 4500), 0);
    const totalLabel  = `PHP ${totalAmount.toLocaleString()}`;
    const siteUrl     = (process.env.SITE_URL || '').replace(/\/+$/, '');
    const heroUrl     = `${siteUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;
    const baseVerifyUrl = `${siteUrl}/.netlify/functions/verify?id=${id}${group_id ? `&group_id=${group_id}` : ''}`;
    const JWT_SECRET  = process.env.JWT_SECRET || 'relay2026secret';

    const breakdownRows = allMembers.map(m => `
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;">${m.name}</td>
        <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;text-align:center;">${m.student_status === "student" ? "Student" : "Non-Student"}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#2A3D4A;text-align:right;">${m.student_status === "student" ? "PHP 3,000" : "PHP 4,500"}</td>
      </tr>`).join("");

    const breakdownTable = `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin:16px 0;">
        <thead><tr style="background:#f7fafb;">
          <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:left;">Participant</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:center;">Type</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:right;">Amount</th>
        </tr></thead>
        <tbody>${breakdownRows}</tbody>
        <tfoot><tr style="background:#f7fafb;border-top:2px solid #D4E2EA;">
          <td colspan="2" style="padding:10px 12px;font-size:13px;font-weight:700;color:#2A3D4A;">Total</td>
          <td style="padding:10px 12px;font-size:14px;font-weight:700;color:#2E7048;text-align:right;">${totalLabel}</td>
        </tr></tfoot>
      </table>`;

    const { data: allAdmins } = await supabase.from('admins').select('email, name, permissions, force_password_change');
    const notifyAdmins = (allAdmins || []).filter(a => a.permissions?.receive_updates && !a.force_password_change);
    for (const admin of notifyAdmins) {
      const canVerify = !!admin.permissions?.verify_payment;
      const adminToken = canVerify
        ? jwt.sign({ email: admin.email, name: admin.name }, JWT_SECRET, { expiresIn: '30d' })
        : null;
      const verifyLink = adminToken ? `${baseVerifyUrl}&atoken=${adminToken}` : baseVerifyUrl;
      await getTransporter().sendMail({
        from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to:      admin.email,
        subject: isGroup ? `💰 Group Receipt Submitted — ${reg.name} (+${allMembers.length - 1})` : `💰 Payment Receipt Submitted — ${reg.name}`,
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
        .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
      </style></head><body><div class="wrap">
        <div class="bar"></div>
        <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
        <div class="header"><h1>💰 ${isGroup ? 'Group Receipt' : 'Payment Receipt'} Submitted</h1><p>RELAY Conference Asia Pacific 2026</p></div>
        <div class="body">
          <div class="row"><div class="lbl">Contact</div><div class="val">${reg.name}</div></div>
          <div class="row"><div class="lbl">Email</div><div class="val">${reg.email}</div></div>
          <div class="row"><div class="lbl">Church</div><div class="val">${reg.church}</div></div>
          <div class="row"><div class="lbl">Total</div><div class="val">${totalLabel}</div></div>
          ${isGroup ? `<div class="lbl" style="margin-top:12px;">Participants (${allMembers.length})</div>${breakdownTable}` : ''}
          <hr>
          ${receiptUrl ? `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Payment Screenshot</div><img src="${receiptUrl}" alt="Payment Receipt" style="width:100%;max-width:480px;border-radius:10px;border:1px solid #D4E2EA;display:block;"></div>` : ""}
          <div class="note">${isGroup ? `This group (${allMembers.length} participants) has submitted their GCash receipt.` : 'This registrant has submitted their GCash receipt.'} ${canVerify ? 'Verify the payment and click below to confirm.' : ''}</div>
          ${canVerify ? `<div style="text-align:center;margin-top:24px;"><a href="${verifyLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#2E7048;">✅ Verify Payment &amp; Confirm Registration</a></div>` : ''}
        </div>
        <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific</div>
      </div></body></html>`,
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
