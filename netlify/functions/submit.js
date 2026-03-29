// netlify/functions/submit.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";


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

function feeFor(studentStatus) {
  return studentStatus === "student" ? 3000 : 4500;
}
function feeLabel(studentStatus) {
  return studentStatus === "student" ? "PHP 3,000" : "PHP 4,500";
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const body = JSON.parse(event.body);
    const { email, church, otherChurch, paymentReady, receiptBase64, receiptName,
            registrationType, participants } = body;

    const churchName = church === "others" ? otherChurch : church;
    const transporter = getTransporter();
    const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
    const imgUrl  = (process.env.IMAGE_SITE_URL || siteUrl).replace(/\/+$/, '');
    const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;
    const qrUrl   = `${imgUrl}/assets/images/qr/gcash-qr-email.jpg?v=${Date.now()}`;
    const isGroup = registrationType === "group";

    // Duplicate email check
    const { data: existing } = await supabase
      .from("registrations")
      .select("id, payment_verified")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      if (existing.payment_verified) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: "already_confirmed", message: "This email has already been registered and confirmed. Please contact us if you need help." }) };
      }
      return { statusCode: 409, headers, body: JSON.stringify({ error: "already_registered", message: "This email already has a pending registration. Check your inbox for payment instructions, or contact us for help." }) };
    }

    // Upload shared receipt (pay now)
    let receiptUrl = null;
    if (paymentReady === "now" && receiptBase64) {
      const ext  = receiptName?.split(".").pop() || "jpg";
      const path = `receipts/${Date.now()}-group.${ext}`;
      const buf  = Buffer.from(receiptBase64, "base64");
      const { error } = await supabase.storage.from("relay-uploads").upload(path, buf, { contentType: `image/${ext}` });
      if (!error) {
        const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
        receiptUrl = data.publicUrl;
      }
    }

    const group_id   = isGroup ? randomUUID() : null;
    const group_size = isGroup ? participants.length : 1;
    const status     = paymentReady === "now" ? "payment_pending_review" : "awaiting_payment";

    // Insert one row per participant
    const insertedRows = [];
    for (const p of participants) {
      let schoolIdUrl = null;
      if (p.studentStatus === "student" && p.schoolIdBase64) {
        const ext  = p.schoolIdName?.split(".").pop() || "jpg";
        const path = `school-ids/${Date.now()}-${p.name.replace(/\s+/g, "_")}.${ext}`;
        const buf  = Buffer.from(p.schoolIdBase64, "base64");
        const { error } = await supabase.storage.from("relay-uploads").upload(path, buf, { contentType: `image/${ext}` });
        if (!error) {
          const { data } = supabase.storage.from("relay-uploads").getPublicUrl(path);
          schoolIdUrl = data.publicUrl;
        }
      }

      const { data: reg, error: dbErr } = await supabase
        .from("registrations")
        .insert({
          name:             p.name,
          age:              parseInt(p.age),
          mobile:           p.mobile,
          email:            email.toLowerCase().trim(),
          student_status:   p.studentStatus,
          church:           churchName,
          payment_ready:    paymentReady === "now",
          school_id_url:    schoolIdUrl,
          receipt_url:      receiptUrl,
          payment_verified: false,
          status,
          group_id,
          group_size,
        })
        .select().single();

      if (dbErr) throw new Error("DB insert failed: " + dbErr.message);
      insertedRows.push(reg);
    }

    const primaryReg  = insertedRows[0];
    const primaryName = participants[0].name;
    const totalAmount = participants.reduce((sum, p) => sum + feeFor(p.studentStatus), 0);
    const totalLabel  = `PHP ${totalAmount.toLocaleString()}`;
    const baseVerifyUrl = `${siteUrl}/.netlify/functions/verify?id=${primaryReg.id}${isGroup ? `&group_id=${group_id}` : ''}`;
    const JWT_SECRET = process.env.JWT_SECRET || 'relay2026secret';

    const breakdownTable = buildBreakdownTable(participants, totalLabel);

    if (paymentReady === "now") {
      // Send per-admin — CTA only for those with verify_payment permission
      const { data: allAdmins } = await supabase.from('admins').select('email, name, permissions, force_password_change');
      const notifyAdmins = (allAdmins || []).filter(a => a.permissions?.receive_updates && !a.force_password_change);
      for (const admin of notifyAdmins) {
        const canVerify = !!admin.permissions?.verify_payment;
        const adminToken = canVerify
          ? jwt.sign({ email: admin.email, name: admin.name }, JWT_SECRET, { expiresIn: '30d' })
          : null;
        const verifyLink = adminToken ? `${baseVerifyUrl}&atoken=${adminToken}` : baseVerifyUrl;
        await transporter.sendMail({
          from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
          to:      admin.email,
          subject: isGroup ? `New Group Registration + Payment — ${primaryName} (+${participants.length - 1})` : `New Registration + Payment — ${primaryName}`,
          html:    adminPaymentEmail({ participants, churchName, totalLabel, receiptUrl, verifyLink, heroUrl, isGroup, breakdownTable, canVerify }),
        });
      }
      await transporter.sendMail({
        from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to:      email,
        subject: "RELAY 2026 — We received your registration!",
        html:    registrantAckEmail({ primaryName, churchName, heroUrl, isGroup, participants, breakdownTable, totalLabel }),
      });
    } else {
      // Send per-admin (no CTA needed for awaiting payment)
      const { data: allAdmins2 } = await supabase.from('admins').select('email, name, permissions, force_password_change');
      const notifyAdmins2 = (allAdmins2 || []).filter(a => a.permissions?.receive_updates && !a.force_password_change);
      for (const admin of notifyAdmins2) {
        await transporter.sendMail({
          from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
          to:      admin.email,
          subject: isGroup ? `New Group Registration (Awaiting Payment) — ${primaryName} (+${participants.length - 1})` : `New Registration (Awaiting Payment) — ${primaryName}`,
          html:    adminAwaitingEmail({ participants, churchName, totalLabel, heroUrl, isGroup, breakdownTable }),
        });
      }
      await transporter.sendMail({
        from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
        to:      email,
        subject: "RELAY 2026 — Complete your registration",
        html:    registrantPaymentEmail({
          primaryName, totalLabel, qrUrl, heroUrl, siteUrl, imgUrl,
          registrationId: primaryReg.id,
          group_id, isGroup, participants, breakdownTable,
          gcashAccountName:   process.env.GCASH_ACCOUNT_NAME,
          gcashAccountHolder: process.env.GCASH_ACCOUNT_HOLDER,
          gcashMobile:        process.env.GCASH_MOBILE,
        }),
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: primaryReg.id }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function buildBreakdownTable(participants, totalLabel) {
  const rows = participants.map(p => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;">${p.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;text-align:center;">${p.studentStatus === "student" ? "Student" : "Non-Student"}</td>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;text-align:right;font-weight:600;">${feeLabel(p.studentStatus)}</td>
    </tr>`).join("");

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin:16px 0;">
      <thead>
        <tr style="background:#f7fafb;">
          <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:left;letter-spacing:0.08em;">Participant</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:center;letter-spacing:0.08em;">Type</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:right;letter-spacing:0.08em;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:#f7fafb;border-top:2px solid #D4E2EA;">
          <td colspan="2" style="padding:10px 12px;font-size:13px;font-weight:700;color:#2A3D4A;">Total</td>
          <td style="padding:10px 12px;font-size:14px;font-weight:700;color:#2E7048;text-align:right;">${totalLabel}</td>
        </tr>
      </tfoot>
    </table>`;
}

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

function r(l, v) { return `<div class="row"><div class="lbl">${l}</div><div class="val">${v}</div></div>`; }

function adminPaymentEmail({ participants, churchName, totalLabel, receiptUrl, verifyLink, heroUrl, isGroup, breakdownTable, canVerify }) {
  const primaryName = participants[0].name;
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#2A3D4A)',
    headerTitle: isGroup ? 'New Group Registration + Payment' : 'New Registration + Payment',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      ${r('Contact / Registrant', primaryName)}${r('Church', churchName)}${r('Total Amount', totalLabel)}
      ${isGroup ? `<div class="lbl" style="margin-top:12px;">Participants (${participants.length})</div>${breakdownTable}` : r('Type', participants[0].studentStatus === 'student' ? 'Student' : 'Non-Student')}
      <hr>
      ${receiptUrl ? `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Payment Screenshot</div><img src="${receiptUrl}" alt="Payment Receipt" style="width:100%;max-width:480px;border-radius:10px;border:1px solid #D4E2EA;display:block;"></div>` : ''}
      <div class="note">Check your GCash app to confirm payment was received${canVerify ? ', then click the button below to confirm.' : '.'}</div>
      ${canVerify ? `<div style="text-align:center;margin-top:24px;"><a href="${verifyLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#2E7048;">✅ Verify Payment &amp; Confirm Registration</a></div>` : ''}`
  });
}

function adminAwaitingEmail({ participants, churchName, totalLabel, heroUrl, isGroup, breakdownTable }) {
  const primaryName = participants[0].name;
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#2A3D4A)',
    headerTitle: isGroup ? 'New Group Registration (Awaiting Payment)' : 'New Registration (Awaiting Payment)',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      ${r('Contact / Registrant', primaryName)}${r('Church', churchName)}${r('Total Amount', totalLabel)}
      ${isGroup ? `<div class="lbl" style="margin-top:12px;">Participants (${participants.length})</div>${breakdownTable}` : r('Type', participants[0].studentStatus === 'student' ? 'Student' : 'Non-Student')}
      <div class="note">This registrant chose to pay later. Payment instructions have been sent to their email.</div>`
  });
}

function registrantAckEmail({ primaryName, churchName, heroUrl, isGroup, participants, breakdownTable }) {
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#2E7048)',
    headerTitle: 'We received your registration!',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${primaryName}</strong>, thank you for registering for RELAY 2026! 🎉</p>
      ${r('Church', churchName)}
      ${isGroup ? `<div class="lbl" style="margin-top:12px;">Registered Participants (${participants.length})</div>${breakdownTable}` : r('Type', participants[0].studentStatus === 'student' ? 'Student' : 'Non-Student')}
      <hr>
      <div class="note">Your payment screenshot has been received. Our team will verify it and send you a confirmation email shortly.</div>
      ${participants.some(p => p.studentStatus === 'student') ? '<div class="note" style="margin-top:8px;">🪪 School IDs submitted will also be reviewed to confirm student discounts.</div>' : ''}
      <div class="info-box" style="margin-top:16px;">
        <strong>📍 Location:</strong> CCT Tagaytay Retreat and Training Center<br>
        <strong>🗓 Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br>
        <strong>✝️ Theme:</strong> Living for Christ Alone
      </div>`
  });
}

function registrantPaymentEmail({ primaryName, totalLabel, qrUrl, heroUrl, siteUrl, imgUrl, registrationId, group_id, isGroup, participants, breakdownTable, gcashAccountName, gcashAccountHolder, gcashMobile }) {
  const uploadLink = `${siteUrl}/upload-receipt?id=${registrationId}${isGroup && group_id ? `&group_id=${group_id}` : ''}`;
  return emailShell({
    heroUrl,
    headerBg: 'linear-gradient(135deg,#1C2B38,#3A8BBF)',
    headerTitle: 'Complete Your Registration',
    headerSub: 'RELAY Conference Asia Pacific 2026',
    body: `
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:16px;">Hi <strong>${primaryName}</strong>, thank you for your interest in RELAY Conference Asia Pacific 2026!</p>
      <p style="font-size:14px;color:#2A3D4A;margin-bottom:20px;">To confirm your slot${isGroup ? 's' : ''}, pay <strong>${totalLabel}</strong> via GCash and submit your receipt.</p>
      ${isGroup ? `<div class="lbl" style="margin-top:12px;">Registered Participants (${participants.length})</div>${breakdownTable}` : ''}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
        <tr><td align="center">
          <table cellpadding="0" cellspacing="0" border="0" style="background:#0A8FD9;border-radius:16px;overflow:hidden;width:100%;max-width:360px;">
            <tr><td style="padding:0;line-height:0;">
              <img src="${imgUrl}/assets/images/gcash-header-email.jpg?v=${Date.now()}" alt="GCash" width="360" style="display:block;width:100%;height:auto;">
            </td></tr>
            <tr><td style="padding:0 14px 14px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F7FA;border-radius:14px;padding:24px 20px;text-align:center;">
                <tr><td align="center" style="padding-bottom:16px;">
                  <img src="${qrUrl}" alt="GCash QR" width="190" height="190" style="display:block;border-radius:10px;border:1px solid #e0e0e0;background:#fff;">
                </td></tr>
                <tr><td style="font-size:13px;color:#666;padding-bottom:14px;">Transfer fees may apply.</td></tr>
                <tr><td style="border-top:1px solid #E0E0E0;padding-top:14px;">
                  <div style="font-size:22px;font-weight:800;color:#0070E0;margin-bottom:4px;">${gcashAccountName || 'CCSGM'}</div>
                  <div style="font-size:14px;font-weight:600;color:#333;margin-bottom:8px;">${gcashAccountHolder || ''}</div>
                  <div style="font-size:13px;padding:4px 0;">
                    <span style="color:#888;">Mobile No.: </span>
                    <span style="color:#444;font-weight:600;font-family:monospace;">${gcashMobile || ''}</span>
                  </div>
                  <div style="margin-top:14px;background:#E8F4FF;border-radius:8px;padding:10px 14px;font-size:13px;color:#0070E0;">
                    💡 <strong>Send Money</strong> in GCash using the mobile number above
                  </div>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
      </table>
      <div class="note">After paying, click the button below to submit your GCash receipt screenshot.</div>
      ${participants.some(p => p.studentStatus === 'student') ? '<div class="note" style="margin-top:8px;">🪪 School IDs submitted will also be reviewed to confirm student discounts.</div>' : ''}
      <div style="text-align:center;margin-top:20px;">
        <a href="${uploadLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:linear-gradient(135deg,#C49A1A,#E8B830);">📎 Submit Payment Receipt</a>
      </div>
      <p style="font-size:11px;color:#6B8A9A;text-align:center;margin-top:10px;">Or copy this link: ${uploadLink}</p>`
  });
}
