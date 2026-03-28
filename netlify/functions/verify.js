// netlify/functions/verify.js
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'relay2026secret';

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

export const handler = async (event) => {
  const { id, group_id, atoken } = event.queryStringParameters || {};
  if (!id) return { statusCode: 400, body: "Missing ID" };

  // Decode admin token — fallback to "email-link" if missing or expired
  let verifiedBy = "email-link";
  if (atoken) {
    try {
      const decoded = jwt.verify(atoken, JWT_SECRET);
      if (decoded?.email) verifiedBy = decoded.email;
    } catch (e) {
      // Token expired or invalid — use fallback
      verifiedBy = "email-link";
    }
  }

  try {
    // Fetch the primary registration
    const { data: reg, error: fetchErr } = await supabase
      .from("registrations").select("*").eq("id", id).single();
    if (fetchErr || !reg) return htmlPage("Not Found", "Registration not found.", false);
    if (reg.payment_verified) return htmlPage("Already Verified", `${reg.name}'s registration was already confirmed.`, true);

    const effectiveGroupId = group_id || reg.group_id || null;

    // Update all group members or just the single row
    if (effectiveGroupId) {
      await supabase.from("registrations")
        .update({ payment_verified: true, status: "confirmed", verified_at: new Date().toISOString(), verified_by: verifiedBy })
        .eq("group_id", effectiveGroupId);
    } else {
      await supabase.from("registrations")
        .update({ payment_verified: true, status: "confirmed", verified_at: new Date().toISOString(), verified_by: verifiedBy })
        .eq("id", id);
    }

    // Fetch all group members for confirmation email
    let allMembers = [reg];
    if (effectiveGroupId) {
      const { data: members } = await supabase.from("registrations")
        .select("*").eq("group_id", effectiveGroupId);
      if (members) allMembers = members;
    }

    const isGroup    = allMembers.length > 1;
    const totalAmount = allMembers.reduce((s, r) => s + (r.student_status === "student" ? 3000 : 4500), 0);
    const totalLabel  = `PHP ${totalAmount.toLocaleString()}`;
    const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, ''); const heroUrl = `${siteUrl}/assets/images/hero-email.jpg`;

    // Send one confirmation email to the shared address
    await getTransporter().sendMail({
      from:    `"RELAY 2026" <${process.env.GMAIL_USER}>`,
      to:      reg.email,
      subject: "RELAY 2026 — You're confirmed! 🎉",
      html:    confirmationEmail(reg, allMembers, totalLabel, heroUrl, isGroup),
    });

    const msg = isGroup
      ? `${allMembers.length} participants confirmed. A confirmation email has been sent to ${reg.email}.`
      : `${reg.name}'s payment confirmed. A confirmation email has been sent to ${reg.email}.`;

    return htmlPage("Payment Verified!", msg, true);
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
      .badge{display:inline-block;background:${success ? '#2E7048' : '#C0392B'};color:#fff;border-radius:8px;padding:10px 24px;font-family:'Bebas Neue';font-size:18px;letter-spacing:0.06em;margin-top:24px;}
      .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);border-radius:16px 16px 0 0;margin:-48px -40px 32px;width:calc(100% + 80px);}
    </style></head>
    <body><div class="card">
      <div class="bar"></div>
      <div class="icon">${success ? '✅' : '❌'}</div>
      <h1>${title}</h1><p>${message}</p>
      <div class="badge">RELAY 2026</div>
    </div></body></html>`,
  };
}

function confirmationEmail(primaryReg, allMembers, totalLabel, heroUrl, isGroup) {
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
        <td colspan="2" style="padding:10px 12px;font-size:13px;font-weight:700;color:#2A3D4A;">Total Paid</td>
        <td style="padding:10px 12px;font-size:14px;font-weight:700;color:#2E7048;text-align:right;">${totalLabel}</td>
      </tr></tfoot>
    </table>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;"><div style="max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);"></div>
    <img src="${heroUrl}" alt="RELAY 2026" width="580" style="width:100%;height:auto;display:block;">
    <div style="background:linear-gradient(135deg,#1C2B38,#2E7048);padding:28px 32px;text-align:center;"><h1 style="color:#fff;font-size:22px;margin:0;">${isGroup ? 'Your group is confirmed! 🎉' : "You're confirmed! 🎉"}</h1><p style="color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;">RELAY Conference Asia Pacific 2026</p></div>
    <div style="padding:32px;">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${primaryReg.name}</strong>, your payment has been verified and ${isGroup ? 'all participants are' : 'your registration is'} confirmed. We can't wait to see you in Tagaytay!</p>
      <div style="background:#EAF5EE;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px;">
        <h2 style="color:#2E7048;font-size:20px;margin:0 0 4px;">Registration Confirmed ✅</h2>
        <p style="color:#4BAE6A;font-size:13px;margin:0;">${isGroup ? `${allMembers.length} participants · Slots reserved for RELAY 2026` : 'Your slot is reserved for RELAY 2026'}</p>
      </div>
      <div style="margin-bottom:12px;"><div style="font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;">Church</div><div style="color:#2A3D4A;font-size:14px;margin-top:3px;">${primaryReg.church}</div></div>
      ${isGroup ? `<div style="font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;margin-top:12px;">Participants (${allMembers.length})</div>${breakdownTable}` : `
        <div style="margin-bottom:12px;"><div style="font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;">Name</div><div style="color:#2A3D4A;font-size:14px;margin-top:3px;">${primaryReg.name}</div></div>
        <div style="margin-bottom:12px;"><div style="font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;">Type</div><div style="color:#2A3D4A;font-size:14px;margin-top:3px;">${primaryReg.student_status === "student" ? "Student" : "Non-Student"}</div></div>
        <div style="margin-bottom:12px;"><div style="font-weight:700;color:#6B8A9A;text-transform:uppercase;font-size:10px;letter-spacing:0.08em;">Amount Paid</div><div style="color:#2A3D4A;font-size:14px;margin-top:3px;">${totalLabel}</div></div>`}
      <hr style="border:none;border-top:1px solid #D4E2EA;margin:20px 0;">
      <div style="background:#EBF5FB;border-radius:10px;padding:16px 20px;font-size:13px;color:#2A3D4A;line-height:1.8;">
        <strong>📍 Location:</strong> CCT Tagaytay Retreat and Training Center<br>
        <strong>🗓 Date:</strong> September 23–26, 2026 (4 Days, 3 Nights)<br>
        <strong>✝️ Theme:</strong> Living for Christ Alone
      </div>
    </div>
    <div style="background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}
