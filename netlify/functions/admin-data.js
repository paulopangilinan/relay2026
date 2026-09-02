// netlify/functions/admin-data.js
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { sendEmail, normalizeProvider, resendConfigured } from '../lib/mailer.js';
import { sendToDistinctMobiles, sendAndLogSMS, smsConfigured, smsReady, smsSenderName, estimateSegments, getSMSAccount } from '../lib/sms.js';
import { getNotificationSettings, smsAllowed, templateFor } from '../lib/notification-settings.js';
import { followUpSMS, followUpPartialSMS, confirmedSMS, cancelledSMS, attendanceSMS, merchInviteSMS } from '../lib/sms-templates.js';
import { attendanceLinks } from '../lib/attendance.js';
import { merchLink } from '../lib/merch.js';

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers    = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

/**
 * Base URL for links we put in emails.
 *
 * SITE_URL points at the deployed site, so a link generated while running
 * locally sends the recipient to production — where the function may not exist
 * yet, giving a 404. When the request itself came from localhost we're clearly
 * in dev, so point links back at the running instance.
 *
 * Only localhost is trusted from the Host header. Honouring an arbitrary host
 * in production would let a request forge the links inside outgoing email.
 */
function linkBase(event) {
  const host = (event?.headers?.host || '').toLowerCase();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (isLocal) return `http://${event.headers.host}`;
  return (process.env.SITE_URL || '').replace(/\/+$/, '');
}

async function getAdminsWithPermission(permission) {
  const { data } = await supabase.from('admins').select('email, name, permissions, force_password_change');
  return (data || []).filter(a => a.permissions?.[permission] && !a.force_password_change);
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const requester = getAdmin(event);
  if (!requester) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  // ── GET ?sms_balance=1 : just the Semaphore credit balance ────────────────
  // Kept off the main dashboard payload on purpose — loadData() runs on every
  // refresh and after every action, and this is a third-party HTTP round trip.
  // The send modals ask for it when they open instead.
  if (event.httpMethod === 'GET' && event.queryStringParameters?.sms_balance) {
    if (!smsConfigured()) {
      return { statusCode: 200, headers, body: JSON.stringify({ credit_balance: null }) };
    }
    const account = await getSMSAccount();
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ credit_balance: account?.credit_balance ?? null }),
    };
  }

  // ── GET: fetch all registrations ──────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const { data, error } = await supabase.from('registrations').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      const { data: adminsData } = await supabase.from('admins').select('email, name, force_password_change');
      const notifySettings = await getNotificationSettings(supabase);

      const local = data.filter(r => r.registrant_type !== 'international');
      const intl  = data.filter(r => r.registrant_type === 'international');

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          local, international: intl,
          stats_local: statsFor(local),
          stats_intl:  statsFor(intl),
          admins: adminsData || [],
          admin: { name: requester.name, permissions: requester.permissions, is_super_admin: requester.is_super_admin },
          notifications: {
            ...notifySettings,
            sms_configured:    smsConfigured(),
            // Master gate — no approved sender name means nothing can send yet.
            sms_ready:         smsReady(),
            sms_sender_name:   smsSenderName(),
            resend_configured: resendConfigured(),
            // Derived from the saved template. The sample carries a full-length
            // upload URL because a template using {link} costs materially more
            // than one without, and the bulk modal multiplies this per mobile.
            followup_sms_segments: estimateSegments(followUpSMS({
              name: 'Juan Dela Cruz', totalLabel: 'PHP 4,500', count: 2,
              uploadLink: `${(process.env.SITE_URL || '').replace(/\/+$/, '')}/upload-receipt?id=3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d&group_id=8a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d`,
              template: templateFor(notifySettings, 'followup'),
            })),
            // Part-paid reminders carry the amounts as well, so they cost more
            // per mobile than the plain reminder and need their own estimate.
            followup_partial_sms_segments: estimateSegments(followUpPartialSMS({
              name: 'Juan Dela Cruz', totalLabel: 'PHP 4,500', paidLabel: 'PHP 2,000',
              balanceLabel: 'PHP 2,500', count: 2,
              uploadLink: `${(process.env.SITE_URL || '').replace(/\/+$/, '')}/upload-receipt?id=3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d&group_id=8a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d`,
              template: templateFor(notifySettings, 'followup_partial'),
            })),
            attendance_sms_segments: estimateSegments(attendanceSMS({
              name: 'Juan Dela Cruz', count: 1,
              template: templateFor(notifySettings, 'attendance'),
            })),
          },
        }),
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST: actions ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { action, id } = body;

      // bulk_follow_up carries `ids` instead of a single `id` — it validates
      // its own payload below rather than being forced to send a dummy id.
      if (!action) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action' }) };
      if (!id && !['bulk_follow_up', 'bulk_attendance_invite', 'blast_merch_invite'].includes(action)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
      }

      // ── Mark registrant as added to pre-con (DB only) ─────────────────────
      if (action === 'add_to_precon') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }
        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };
        const now = new Date().toISOString();
        await supabase.from('registrations').update({
          attendance_response: 'attending',
          attendance_responded_at: now,
          attendance_invited_at: now,
        }).eq('id', id);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ── Confirm payment ────────────────────────────────────────────────────
      if (action === 'confirm') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to verify payment' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };

        // Always derive group from DB — never trust client-supplied group_id
        const { scope } = body;
        const effectiveGroupId = scope === 'individual' ? null : (reg.group_id || null);

        const confirmUpdate = {
          payment_verified: true,
          status: 'confirmed',
          verified_at: new Date().toISOString(),
          verified_by: requester.email,
        };
        if (effectiveGroupId) {
          // Never confirm already-cancelled participants — they were removed individually
          await supabase.from('registrations').update(confirmUpdate)
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled');
        } else {
          await supabase.from('registrations').update(confirmUpdate).eq('id', id);
        }

        let allMembers = [reg];
        if (effectiveGroupId) {
          // Only include non-cancelled members in the confirmation email
          const { data: members } = await supabase.from('registrations').select('*')
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled');
          if (members?.length) allMembers = members;
        }

        const isGroup  = allMembers.length > 1;
        const totalAmt = allMembers.reduce((s, r) => s + feeFor(r), 0);
        const imgUrl   = (process.env.IMAGE_SITE_URL || (process.env.SITE_URL || '')).replace(/\/+$/, '');
        const heroUrl  = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;

        await sendEmail({
          to:      reg.email,
          subject: "RELAY 2026 — You're confirmed! 🎉",
          html:    confirmationEmail(reg, allMembers, `PHP ${totalAmt.toLocaleString()}`, heroUrl, isGroup),
        });

        const confirmSettings = await getNotificationSettings(supabase);
        let smsResult = null;
        if (smsAllowed(confirmSettings, 'confirmed')) {
          // Everyone just confirmed hears about it, on their own number.
          smsResult = await sendToDistinctMobiles(supabase, allMembers, {
            event:       'confirmed',
            groupId:     effectiveGroupId,
            triggeredBy: requester.email,
            buildMessage: (member) => confirmedSMS({
              name: member.name, count: allMembers.length,
              totalLabel: `PHP ${totalAmt.toLocaleString()}`,
              template: templateFor(confirmSettings, 'confirmed'),
            }),
          });
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, sms: smsSummary(smsResult) }) };
      }

      // ── Cancel registration ────────────────────────────────────────────────
      if (action === 'cancel') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission to cancel registrations' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };

        const { notify, reason, scope } = body;
        // Always derive group from DB — never trust client-supplied group_id
        const effectiveCancelGroupId = scope === 'individual' ? null : (reg.group_id || null);

        const cancelUpdate = {
          status: 'cancelled',
          payment_verified: false,
          cancelled_by: requester.email,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason || null,
        };
        if (effectiveCancelGroupId) {
          // Never cancel already-confirmed participants — they paid individually
          await supabase.from('registrations').update(cancelUpdate)
            .eq('group_id', effectiveCancelGroupId)
            .neq('status', 'confirmed');
        } else {
          await supabase.from('registrations').update(cancelUpdate).eq('id', id);
        }

        let smsResult = null;
        if (notify) {
          let allMembers = [reg];
          if (effectiveCancelGroupId) {
            // Only include members that were actually cancelled (exclude confirmed ones)
            const { data: members } = await supabase.from('registrations').select('*')
              .eq('group_id', effectiveCancelGroupId)
              .neq('status', 'confirmed');
            if (members?.length) allMembers = members;
          }
          const imgUrl  = (process.env.IMAGE_SITE_URL || (process.env.SITE_URL || '')).replace(/\/+$/, '');
          const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;
          const names   = allMembers.map(m => m.name).join(', ');
          await sendEmail({
            to:      reg.email,
            subject: 'RELAY 2026 — Registration Cancelled',
            html:    cancellationEmail(reg.name, names, allMembers.length > 1, heroUrl),
          });

          const cancelSettings = await getNotificationSettings(supabase);
          if (smsAllowed(cancelSettings, 'cancelled')) {
            // allMembers is already exactly who got cancelled: the group query
            // excludes confirmed members, and the solo path is the single row
            // just cancelled. Re-filtering on status here would drop a solo
            // registration that had been confirmed before it was cancelled,
            // since reg is a snapshot taken before the update.
            smsResult = await sendToDistinctMobiles(supabase, allMembers, {
              event:       'cancelled',
              groupId:     effectiveCancelGroupId,
              triggeredBy: requester.email,
              buildMessage: (member) => cancelledSMS({
                name: member.name, count: allMembers.length,
                template: templateFor(cancelSettings, 'cancelled'),
              }),
            });
          }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, sms: smsSummary(smsResult) }) };
      }

      // ── Follow-up payment reminder ─────────────────────────────────────────
      if (action === 'follow_up') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };
        if (!FOLLOWUP_STATUSES.includes(reg.status)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'This registration has nothing outstanding to chase' }) };
        }

        // Admin picks the sender from the dropdown on the Send Reminder button.
        // Anything other than 'resend' (including nothing) keeps the Gmail path.
        const provider = normalizeProvider(body.email_provider);
        // send_sms lets the admin opt out for a single send; the settings toggle rules otherwise.
        const followUpSettings = await getNotificationSettings(supabase);

        const { mailResult, smsResult } = await runFollowUp(reg, {
          provider,
          sendSms:        body.send_sms !== false,
          settings:       followUpSettings,
          requesterEmail: requester.email,
          siteUrl:        linkBase(event),
        });

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            success:  true,
            provider: mailResult.provider,
            fell_back: !!mailResult.fellBack,
            sms:      smsSummary(smsResult),
          }),
        };
      }

      // ── Bulk follow-up ─────────────────────────────────────────────────────
      // Takes a list of registration ids, collapses group members down to one
      // send per group, and reminds everyone still awaiting payment.
      if (action === 'bulk_follow_up') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
        if (!ids.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No registrations selected' }) };
        if (ids.length > BULK_LIMIT) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Too many at once — send at most ${BULK_LIMIT} per batch` }) };
        }

        const { data: regs, error: fetchErr } = await supabase.from('registrations').select('*').in('id', ids);
        if (fetchErr) throw fetchErr;

        // One reminder per group (they share an email address), one per solo
        // registrant. Collapse to distinct groups FIRST so `skipped` counts
        // reminders not sent, not rows — otherwise a 3-member group that is no
        // longer awaiting payment reports as 3 skips for 1 reminder.
        const targets = [];
        const seen    = new Set();
        let skipped   = 0;
        for (const reg of regs || []) {
          const key = reg.group_id || reg.id;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!FOLLOWUP_STATUSES.includes(reg.status)) { skipped++; continue; }
          targets.push(reg);
        }

        const provider = normalizeProvider(body.email_provider);
        const settings = await getNotificationSettings(supabase);
        const sendSms  = body.send_sms !== false;

        const results = await mapWithConcurrency(targets, BULK_CONCURRENCY, async (reg) => {
          try {
            const { mailResult, smsResult } = await runFollowUp(reg, {
              provider, sendSms, settings, requesterEmail: requester.email,
              siteUrl: linkBase(event),
            });
            return {
              id: reg.id, name: reg.name, email: reg.email, ok: true,
              provider: mailResult.provider, fell_back: !!mailResult.fellBack,
              sms: smsSummary(smsResult),
            };
          } catch (err) {
            console.error(`[bulk_follow_up] ${reg.email} failed:`, err.message);
            return { id: reg.id, name: reg.name, email: reg.email, ok: false, error: err.message };
          }
        });

        const sent   = results.filter(r => r.ok);
        const failed = results.filter(r => !r.ok);
        // A single group can fan out to several mobiles, so count recipients
        // and segments rather than sends.
        const smsSentCount   = sent.reduce((s, r) => s + (r.sms?.sent || 0), 0);
        const smsFailedCount = sent.reduce((s, r) => s + (r.sms?.failed || 0), 0);
        const smsCredits     = sent.reduce((s, r) => s + (r.sms?.segments || 0), 0);

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            success:      true,
            sent:         sent.length,
            failed:       failed.length,
            skipped,                                   // not awaiting payment
            grouped:      (regs?.length || 0) - targets.length - skipped,
            sms_sent:     smsSentCount,
            sms_credits:  smsCredits,
            sms_failed:   smsFailedCount,
            fell_back:    sent.some(r => r.fell_back),
            provider,
            results,
          }),
        };
      }

      // ── Record partial payment ─────────────────────────────────────────────
      if (action === 'partial_payment') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const { date, amount, payment_method, notes } = body;
        if (!date || !amount || amount <= 0 || !payment_method) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };
        if (reg.status === 'confirmed' || reg.status === 'cancelled') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot add partial payment to this registration' }) };
        }

        const effectiveGroupId = reg.group_id || null;
        let allMembers = [reg];
        if (effectiveGroupId) {
          // Only count members who still owe — exclude confirmed (already paid) and cancelled
          const { data: members } = await supabase.from('registrations').select('*')
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled')
            .neq('status', 'confirmed');
          if (members?.length) allMembers = members;
        }

        const totalFee        = allMembers.reduce((s, r) => s + feeFor(r), 0);
        const newPartialTotal = (reg.partial_paid_total || 0) + amount;
        const remaining       = totalFee - newPartialTotal;

        await supabase.from('partial_payments').insert({
          registration_id: id,
          group_id: effectiveGroupId,
          date,
          amount,
          payment_method,
          notes: notes || null,
          recorded_by: requester.email,
        });

        const partialUpdate = { partial_paid_total: newPartialTotal, status: 'partially_paid' };
        if (effectiveGroupId) {
          // Only update members who still owe — never revert a confirmed or cancelled status
          await supabase.from('registrations').update(partialUpdate)
            .eq('group_id', effectiveGroupId)
            .neq('status', 'cancelled')
            .neq('status', 'confirmed');
        } else {
          await supabase.from('registrations').update(partialUpdate).eq('id', id);
        }

        const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
        const imgUrl  = (process.env.IMAGE_SITE_URL || siteUrl).replace(/\/+$/, '');
        const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;

        await sendEmail({
          to:      reg.email,
          subject: 'RELAY 2026 — Partial Payment Received',
          html:    partialPaymentEmail({
            primaryName: reg.name, amount, date, payment_method,
            totalFee, newPartialTotal, remaining,
            isGroup: allMembers.length > 1, heroUrl, siteUrl,
            registrationId: reg.id, group_id: effectiveGroupId,
          }),
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ── Attendance invitation (single) ─────────────────────────────────────
      if (action === 'attendance_invite') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };

        const ineligible = attendanceIneligibleReason(reg);
        if (ineligible) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: ineligible }) };
        }

        const settings = await getNotificationSettings(supabase);
        const { mailResult, smsResult } = await runAttendanceInvite(reg, {
          provider:       normalizeProvider(body.email_provider),
          sendSms:        body.send_sms !== false,
          settings,
          requesterEmail: requester.email,
          siteUrl:        linkBase(event),
        });

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            success: true,
            provider: mailResult.provider,
            fell_back: !!mailResult.fellBack,
            sms: smsSummary(smsResult),
          }),
        };
      }

      // ── Attendance invitation (bulk) ───────────────────────────────────────
      // Per person, not per group: each man needs his own signed link.
      if (action === 'bulk_attendance_invite') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
        if (!ids.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No registrations selected' }) };
        if (ids.length > BULK_LIMIT) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Too many at once — send at most ${BULK_LIMIT} per batch` }) };
        }

        const { data: regs, error: fetchErr } = await supabase.from('registrations').select('*').in('id', ids);
        if (fetchErr) throw fetchErr;

        // Same rule as the single send — the admin picked these people, so the
        // only exclusions are the ones that would be wrong to contact.
        const targets = [];
        let skipped = 0;
        for (const reg of regs || []) {
          if (attendanceIneligibleReason(reg)) skipped++; else targets.push(reg);
        }

        const provider = normalizeProvider(body.email_provider);
        const settings = await getNotificationSettings(supabase);
        const sendSms  = body.send_sms !== false;

        const results = await mapWithConcurrency(targets, BULK_CONCURRENCY, async (reg) => {
          try {
            const { mailResult, smsResult } = await runAttendanceInvite(reg, {
              provider, sendSms, settings, requesterEmail: requester.email,
              siteUrl: linkBase(event),
            });
            return {
              id: reg.id, name: reg.name, email: reg.email, ok: true,
              provider: mailResult.provider, fell_back: !!mailResult.fellBack,
              sms: smsSummary(smsResult),
            };
          } catch (err) {
            console.error(`[bulk_attendance_invite] ${reg.email} failed:`, err.message);
            return { id: reg.id, name: reg.name, email: reg.email, ok: false, error: err.message };
          }
        });

        const sent   = results.filter(r => r.ok);
        const failed = results.filter(r => !r.ok);

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            success:     true,
            sent:        sent.length,
            failed:      failed.length,
            skipped,
            sms_sent:    sent.reduce((s, r) => s + (r.sms?.sent || 0), 0),
            sms_failed:  sent.reduce((s, r) => s + (r.sms?.failed || 0), 0),
            sms_credits: sent.reduce((s, r) => s + (r.sms?.segments || 0), 0),
            fell_back:   sent.some(r => r.fell_back),
            provider,
            results,
          }),
        };
      }

      if (action === 'merch_invite') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        const { data: reg } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
        if (!reg) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found' }) };
        if (reg.status === 'cancelled') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'This registration has been cancelled' }) };
        }

        const settings = await getNotificationSettings(supabase);
        const sendSms  = body.send_sms !== false;
        const { mailResult, smsResult } = await runMerchInvite(reg, {
          provider: normalizeProvider(body.email_provider), sendSms, settings,
          requesterEmail: requester.email, siteUrl: linkBase(event),
        });

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, provider: mailResult.provider, fell_back: !!mailResult.fellBack, sms: smsSummary(smsResult) }),
        };
      }

      if (action === 'blast_merch_invite') {
        if (!requester.permissions?.verify_payment || requester.force_password_change) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'No permission' }) };
        }

        // Allow an admin to target a specific selection of registrations by
        // passing `ids`. When absent, fall back to the previous behaviour of
        // sending to every confirmed & paid participant.
        const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : null;
        if (ids && ids.length > BULK_LIMIT) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Too many at once — send at most ${BULK_LIMIT} per batch` }) };
        }

        let regsResult;
        if (ids && ids.length) {
          const { data, error: fetchErr } = await supabase.from('registrations').select('*').in('id', ids);
          if (fetchErr) throw fetchErr;
          // Exclude cancelled rows only — allow any other status so admins
          // may reach people who plan to pay on-site.
          regsResult = (data || []).filter(r => r && r.status !== 'cancelled');
        } else {
          const { data, error: fetchErr } = await supabase
            .from('registrations')
            .select('*')
            .neq('status', 'cancelled');
          if (fetchErr) throw fetchErr;
          regsResult = data || [];
        }

        const provider = normalizeProvider(body.email_provider);
        const siteUrl  = linkBase(event);
        const settings = await getNotificationSettings(supabase);
        const sendSms  = body.send_sms !== false;
        const results = await mapWithConcurrency(regsResult || [], BULK_CONCURRENCY, async (reg) => {
          try {
            const { mailResult, smsResult } = await runMerchInvite(reg, {
              provider, sendSms, settings, requesterEmail: requester.email, siteUrl,
            });
            return {
              id: reg.id, name: reg.name, email: reg.email, ok: true,
              provider: mailResult.provider, fell_back: !!mailResult.fellBack,
              sms: smsSummary(smsResult),
            };
          } catch (err) {
            console.error(`[blast_merch_invite] ${reg.email} failed:`, err.message);
            return { id: reg.id, name: reg.name, email: reg.email, ok: false, error: err.message };
          }
        });

        const sent   = results.filter(r => r.ok);
        const failed = results.filter(r => !r.ok);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            success: true,
            sent: sent.length,
            failed: failed.length,
            sms_sent:    sent.reduce((s, r) => s + (r.sms?.sent || 0), 0),
            sms_failed:  sent.reduce((s, r) => s + (r.sms?.failed || 0), 0),
            sms_credits: sent.reduce((s, r) => s + (r.sms?.segments || 0), 0),
            fell_back: sent.some(r => r.fell_back),
            provider,
            results,
          }),
        };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    } catch (err) {
      console.error(err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};

function feeFor(r) {
  if (r.registrant_type === 'international') return 250;
  return r.student_status === 'student' ? 3000 : 4500;
}

// Bulk sends run inside the normal 10s function budget, so the dashboard
// chunks its selection and each chunk stays small enough to finish in time.
// Each bulk item is now one whole group: an email plus a parallel SMS fan-out
// to every member's mobile. Smaller batches with more concurrency keep a run
// inside the 10s function budget.
const BULK_LIMIT       = 15;
const BULK_CONCURRENCY = 6;

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

// A payment reminder makes sense for anyone who still owes money — unpaid or
// part-paid. Confirmed and cancelled registrations are never chased.
const FOLLOWUP_STATUSES = ['awaiting_payment', 'partially_paid'];

/**
 * Send one payment reminder (email + optional SMS) and stamp last_followup_at.
 * Shared by the single-row action and the bulk action so both behave identically.
 * Assumes the caller has already checked the status is in FOLLOWUP_STATUSES.
 */
async function runFollowUp(reg, { provider, sendSms, settings, requesterEmail, siteUrl: baseUrl }) {
  const effectiveGroupId = reg.group_id || null;

  let allMembers = [reg];
  if (effectiveGroupId) {
    // Only include members who still need to pay — skip confirmed and cancelled
    const { data: members } = await supabase.from('registrations').select('*')
      .eq('group_id', effectiveGroupId)
      .neq('status', 'confirmed')
      .neq('status', 'cancelled');
    if (members?.length) allMembers = members;
  }

  const isGroup    = allMembers.length > 1;
  const totalAmt   = allMembers.reduce((s, r) => s + feeFor(r), 0);
  const totalLabel = `PHP ${totalAmt.toLocaleString()}`;
  const siteUrl    = (baseUrl || process.env.SITE_URL || '').replace(/\/+$/, '');
  const imgUrl     = (process.env.IMAGE_SITE_URL || siteUrl).replace(/\/+$/, '');
  const heroUrl    = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;
  const qrUrl      = `${imgUrl}/assets/images/qr/gcash-qr-email.jpg?v=${Date.now()}`;

  // Partially-paid registrants get a different message on both channels:
  // telling someone who has already paid something that we haven't received
  // their payment is wrong, and the figure that matters to them is the
  // outstanding balance, not the gross fee. partial_paid_total is written to
  // every owing member of a group, so the contact row carries the group total.
  const partialPaid   = reg.partial_paid_total || 0;
  const isPartial     = reg.status === 'partially_paid' && partialPaid > 0;
  const balanceAmt    = Math.max(0, totalAmt - partialPaid);
  const paidLabel     = `PHP ${partialPaid.toLocaleString()}`;
  const balanceLabel  = `PHP ${balanceAmt.toLocaleString()}`;
  const smsEvent      = isPartial ? 'followup_partial' : 'followup';

  const mailResult = await sendEmail({
    provider,
    to:      reg.email,
    subject: isPartial ? 'RELAY 2026 — Outstanding Balance Reminder' : 'RELAY 2026 — Payment Reminder',
    html:    paymentReminderEmail({
      primaryName: reg.name, totalLabel, paidLabel, balanceLabel, isPartial,
      qrUrl, heroUrl, siteUrl, imgUrl,
      registrationId: reg.id, group_id: effectiveGroupId, isGroup, allMembers,
      gcashAccountName:   process.env.GCASH_ACCOUNT_NAME,
      gcashAccountHolder: process.env.GCASH_ACCOUNT_HOLDER,
      gcashMobile:        process.env.GCASH_MOBILE,
    }),
  });

  // One email per group (they share an address) but SMS goes to every distinct
  // mobile — group members each gave their own number, and a reminder that only
  // reaches the contact person leaves the rest unaware they still owe payment.
  //
  // Only members who still owe are texted. Participants can now be marked paid
  // individually, and allMembers still carries payment_pending_review rows that
  // shouldn't be chased for payment.
  let smsResult = null;
  if (sendSms && smsAllowed(settings, smsEvent)) {
    // Chase everyone in the group who still owes something, whatever mix of
    // unpaid and part-paid rows that is — narrowing to a single status left
    // members of a mixed group with no reminder at all. The amounts are
    // group-level, so one body is correct for all of them.
    const smsRecipients = allMembers.filter(m => FOLLOWUP_STATUSES.includes(m.status));
    const uploadLink = `${siteUrl}/upload-receipt?id=${reg.id}${isGroup && effectiveGroupId ? `&group_id=${effectiveGroupId}` : ''}`;
    const build = isPartial ? followUpPartialSMS : followUpSMS;
    smsResult = await sendToDistinctMobiles(supabase, smsRecipients, {
      event:       smsEvent,
      groupId:     effectiveGroupId,
      triggeredBy: requesterEmail,
      buildMessage: (member) => build({
        name: member.name, totalLabel, paidLabel, balanceLabel, uploadLink,
        count: smsRecipients.length,
        template: templateFor(settings, smsEvent),
      }),
    });
  }

  const followupTs = new Date().toISOString();
  if (effectiveGroupId) {
    // Only stamp the timestamp on members who still owe payment
    await supabase.from('registrations').update({ last_followup_at: followupTs })
      .eq('group_id', effectiveGroupId)
      .neq('status', 'confirmed')
      .neq('status', 'cancelled');
  } else {
    await supabase.from('registrations').update({ last_followup_at: followupTs }).eq('id', reg.id);
  }

  return { mailResult, smsResult };
}

/**
 * Can this registrant be invited to the pre-conference sessions?
 *
 * Payment status is deliberately not a factor — the sessions are open to every
 * participant, paid or not. Only recorded females and cancelled registrations
 * are excluded; an unrecorded gender is allowed because the admin selects
 * people explicitly and the dashboard warns them.
 *
 * Returns null when eligible, or a reason string.
 */
function attendanceIneligibleReason(reg) {
  if (reg.registrant_type === 'international') return 'The pre-conference invitation is for Philippine participants only';
  if (reg.status === 'cancelled')              return 'This registration has been cancelled';
  if (reg.gender === 'female')                 return 'This registrant is recorded as female';
  return null;
}

/**
 * Send one attendance invitation: email with the two CTA links, plus the
 * optional SMS pointing at it. Unlike a follow-up this is strictly per person —
 * every man needs his own signed link, so group members are NOT collapsed.
 */
async function runAttendanceInvite(reg, { provider, sendSms, settings, requesterEmail, siteUrl }) {
  const imgUrl  = (process.env.IMAGE_SITE_URL || siteUrl || '').replace(/\/+$/, '');
  const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;

  const mailResult = await sendEmail({
    provider,
    to:      reg.email,
    subject: `${String(reg.name || '').trim().split(/\s+/)[0]}, you're invited to the Aspiring Leaders Pre-Conference Session`,
    html:    attendanceEmail({ name: reg.name, heroUrl, links: attendanceLinks(siteUrl, reg.id) }),
  });

  let smsResult = null;
  if (sendSms && smsAllowed(settings, 'attendance')) {
    smsResult = await sendToDistinctMobiles(supabase, [reg], {
      event:       'attendance',
      groupId:     reg.group_id || null,
      triggeredBy: requesterEmail,
      buildMessage: (member) => attendanceSMS({
        name: member.name, count: 1,
        template: templateFor(settings, 'attendance'),
      }),
    });
  }

  await supabase.from('registrations')
    .update({ attendance_invited_at: new Date().toISOString() })
    .eq('id', reg.id);

  return { mailResult, smsResult };
}

// Merch preorder invite — email always (unless skipped because a group
// member already received it), SMS only when merch_sms_enabled is on (its
// own dedicated switch, independent of the shared sms_enabled gate the
// other event types share) and the caller didn't opt out.
async function runMerchInvite(reg, { provider, sendSms, settings, requesterEmail, siteUrl }, { skipEmail = false } = {}) {
  const imgUrl  = (process.env.IMAGE_SITE_URL || siteUrl || '').replace(/\/+$/, '');
  const heroUrl = `${imgUrl}/assets/images/hero-email.jpg?v=${Date.now()}`;

  let mailResult = null;
  if (!skipEmail) {
    const { data: productRows } = await supabase
      .from('merch_products')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    mailResult = await sendEmail({
      provider,
      to:      reg.email,
      subject: `${String(reg.name || '').trim().split(/\s+/)[0]}, preorder your RELAY 2026 merch`,
      html:    merchInviteEmail({ name: reg.name, heroUrl, orderLink: merchLink(siteUrl, reg.id), products: productRows || [] }),
    });
  }

  let smsResult = null;
  if (sendSms && settings?.merch_sms_enabled) {
    smsResult = await sendAndLogSMS(supabase, {
      to:             reg.mobile,
      message:        merchInviteSMS({ name: reg.name, template: settings.merch_sms_template }),
      event:          'merch_invite',
      registrationId: reg.id,
      groupId:        reg.group_id || null,
      triggeredBy:    requesterEmail,
    });
  }

  return { mailResult, smsResult };
}

// Compact shape the dashboard uses for its toast. null = SMS was not attempted.
// Accepts one result or a list, since group sends fan out to several mobiles.
function smsSummary(result) {
  if (!result) return null;
  const list = Array.isArray(result) ? result : [result];
  if (!list.length) return null;

  const sent    = list.filter(r => r.sent);
  const skipped = list.filter(r => !r.sent && r.skipped);
  const failed  = list.filter(r => !r.sent && !r.skipped);

  return {
    status:     sent.length ? 'sent' : (failed.length ? 'failed' : 'skipped'),
    recipients: list.length,
    sent:       sent.length,
    failed:     failed.length,
    segments:   sent.reduce((s, r) => s + (r.segments || 0), 0),
    reason:     failed[0]?.error || skipped[0]?.skipped || undefined,
  };
}

function statsFor(subset) {
  subset = subset || [];
  const active        = subset.filter(r => r.status !== 'cancelled');
  const confirmed     = subset.filter(r => r.status === 'confirmed');
  const pendingReview = subset.filter(r => r.status === 'payment_pending_review');
  const awaitingPay   = subset.filter(r => r.status === 'awaiting_payment');
  const partiallyPaid = subset.filter(r => r.status === 'partially_paid');
  const cancelled     = subset.filter(r => r.status === 'cancelled');
  // Deduplicate groups for partial_revenue to avoid counting the same payment per member
  const seenGroups = new Set();
  const partial_revenue = partiallyPaid.reduce((sum, r) => {
    if (r.group_id) { if (seenGroups.has(r.group_id)) return sum; seenGroups.add(r.group_id); }
    return sum + (r.partial_paid_total || 0);
  }, 0);
  return {
    total:             active.length,
    confirmed:         confirmed.length,
    pending_review:    pendingReview.length,
    awaiting_payment:  awaitingPay.length,
    partially_paid:    partiallyPaid.length,
    cancelled:         cancelled.length,
    confirmed_revenue: confirmed.reduce((s, r) => s + feeFor(r), 0),
    pending_revenue:   pendingReview.reduce((s, r) => s + feeFor(r), 0),
    awaiting_revenue:  awaitingPay.reduce((s, r) => s + feeFor(r), 0),
    partial_revenue,
    students:          active.filter(r => r.student_status === 'student').length,
    non_students:      active.filter(r => r.student_status === 'non-student').length,
    by_country:        active.reduce((acc, r) => { if (r.country) acc[r.country] = (acc[r.country]||0)+1; return acc; }, {}),
    by_church:         active.reduce((acc, r) => { if (r.church) acc[r.church] = (acc[r.church]||0)+1; return acc; }, {}),
  };
}

function cancellationEmail(primaryName, names, isGroup, heroUrl) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#C0392B);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>Registration Cancelled</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:16px;">Hi <strong>${primaryName}</strong>,</p>
      <p style="font-size:14px;color:#2A3D4A;line-height:1.7;">Your${isGroup ? ' group' : ''} registration for RELAY 2026 has been cancelled${isGroup ? ` (${names})` : ''}. If you believe this is a mistake or would like to re-register, please reach out to us.</p>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · Questions? Reply to this email.</div>
  </div></body></html>`;
}

function paymentReminderEmail({ primaryName, totalLabel, paidLabel, balanceLabel, isPartial, qrUrl, heroUrl, siteUrl, imgUrl, registrationId, group_id, isGroup, allMembers, gcashAccountName, gcashAccountHolder, gcashMobile }) {
  const uploadLink = `${siteUrl}/upload-receipt?id=${registrationId}${isGroup && group_id ? `&group_id=${group_id}` : ''}`;

  // Someone who has already paid part of the fee must be asked for the balance,
  // never the gross amount again — the same distinction the SMS makes.
  const cell = 'padding:10px 12px;font-size:13px;font-weight:700;color:#2A3D4A;';
  const amt  = 'padding:10px 12px;font-size:14px;font-weight:700;text-align:right;';
  const partialFootRows = isPartial ? `
          <tr style="background:#f7fafb;">
            <td colspan="2" style="${cell}font-weight:600;color:#6B8A9A;">Payments received</td>
            <td style="${amt}color:#6B8A9A;">− ${paidLabel}</td>
          </tr>
          <tr style="background:#f7fafb;border-top:2px solid #D4E2EA;">
            <td colspan="2" style="${cell}">Balance due</td>
            <td style="${amt}color:#C0392B;">${balanceLabel}</td>
          </tr>` : '';
  // Solo registrants get no participant breakdown, so the figures need a home.
  const partialPanel = (isPartial && !isGroup) ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin:0 0 20px;">
        <tr><td style="${cell}font-weight:600;color:#6B8A9A;">Total registration fee</td>
            <td style="${amt}color:#2A3D4A;">${totalLabel}</td></tr>
        <tr><td style="${cell}font-weight:600;color:#6B8A9A;">Payments received</td>
            <td style="${amt}color:#6B8A9A;">− ${paidLabel}</td></tr>
        <tr style="background:#f7fafb;border-top:2px solid #D4E2EA;">
            <td style="${cell}">Balance due</td>
            <td style="${amt}color:#C0392B;">${balanceLabel}</td></tr>
      </table>` : '';
  const intro = isPartial
    ? `Thank you — we've received <strong>${paidLabel}</strong> toward your registration so far. To confirm your slot${isGroup ? 's' : ''}, please send the remaining balance of <strong>${balanceLabel}</strong> via GCash and submit your receipt.`
    : `Just a friendly reminder — your slot${isGroup ? 's are' : ' is'} still pending payment. To confirm your registration, please send <strong>${totalLabel}</strong> via GCash and submit your receipt.`;
  const breakdownRows = allMembers.map(m => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;">${m.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;text-align:center;">${m.student_status === 'student' ? 'Student' : 'Non-Student'}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#2A3D4A;text-align:right;">${m.student_status === 'student' ? 'PHP 3,000' : 'PHP 4,500'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#3A8BBF);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .note{background:#FDF6E0;border-left:3px solid #E8B830;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#7A5A10;line-height:1.6;margin:16px 0;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>${isPartial ? 'Balance Reminder' : 'Payment Reminder'}</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:16px;">Hi <strong>${primaryName}</strong>,</p>
      <p style="font-size:14px;color:#2A3D4A;margin-bottom:20px;">${intro}</p>
      ${partialPanel}
      ${isGroup ? `
        <div style="margin-bottom:4px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;">Registered Participants (${allMembers.length})</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin:12px 0 20px;">
          <thead><tr style="background:#f7fafb;">
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:left;letter-spacing:0.08em;">Participant</th>
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:center;letter-spacing:0.08em;">Type</th>
            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;text-align:right;letter-spacing:0.08em;">Amount</th>
          </tr></thead>
          <tbody>${breakdownRows}</tbody>
          <tfoot><tr style="background:#f7fafb;border-top:2px solid #D4E2EA;">
            <td colspan="2" style="padding:10px 12px;font-size:13px;font-weight:700;color:#2A3D4A;">Total</td>
            <td style="padding:10px 12px;font-size:14px;font-weight:700;color:#2E7048;text-align:right;">${totalLabel}</td>
          </tr>${partialFootRows}</tfoot>
        </table>` : ''}
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
      <div style="text-align:center;margin-top:20px;">
        <a href="${uploadLink}" style="display:inline-block;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:linear-gradient(135deg,#C49A1A,#E8B830);">📎 Submit Payment Receipt</a>
      </div>
      <p style="font-size:11px;color:#6B8A9A;text-align:center;margin-top:10px;">Or copy this link: ${uploadLink}</p>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · CCT Tagaytay · Sept 23–26, 2026</div>
  </div></body></html>`;
}

function attendanceEmail({ name, heroUrl, links }) {
  const firstName = String(name || '').trim().split(/\s+/)[0] || 'there';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#3A8BBF);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .session-box{background:#EBF5FB;border-radius:10px;padding:18px 22px;margin:18px 0;}
    .session-title{font-size:16px;font-weight:700;color:#1C2B38;margin-bottom:10px;}
    .session-row{font-size:13px;color:#2A3D4A;line-height:1.9;}
    .note{background:#FDF6E0;border-left:3px solid #E8B830;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#7A5A10;line-height:1.6;margin:18px 0;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>You're Invited</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:14px;">Hi <strong>${firstName}</strong>,</p>

      <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:14px;">
        Your slot at <strong>RELAY Conference Asia Pacific 2026</strong> is confirmed — thank you for registering.
      </p>

      <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:4px;">
        As part of the conference, male participants are invited to the
        <strong>Aspiring Leaders Pre-Conference Session</strong>, held on the first day
        before the main programme begins.
      </p>

      <div class="session-box">
        <div class="session-title">Aspiring Leaders Pre-Conference Session</div>
        <div class="session-row">
          🗓 <strong>Tuesday, September 23, 2026</strong><br>
          🕑 <strong>2:00 PM to 6:00 PM</strong><br>
          📍 CCT Tagaytay Retreat and Training Center
        </div>
      </div>

      <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin:0 0 4px;">
        Please let us know whether you'll be joining. Your answer helps us prepare
        the room and materials for everyone attending.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
        <tr>
          <td align="center" style="padding-bottom:10px;">
            <a href="${links.attending}" style="display:inline-block;padding:15px 34px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#fff;background:#2E7048;">✅ Yes, I'll be there</a>
          </td>
        </tr>
        <tr>
          <td align="center">
            <a href="${links.not_attending}" style="display:inline-block;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;color:#6B8A9A;background:#f0f4f7;border:1px solid #D4E2EA;">🚫 I can't make it</a>
          </td>
        </tr>
      </table>

      <div class="note">You can change your answer any time by clicking the other button in this email.</div>
      <p style="font-size:11px;color:#6B8A9A;line-height:1.6;margin-top:14px;">
        Buttons not working? Copy one of these into your browser:<br>
        <strong>Joining:</strong> ${links.attending}<br>
        <strong>Not joining:</strong> ${links.not_attending}
      </p>
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · CCT Tagaytay · Sept 23–26, 2026</div>
  </div></body></html>`;
}

function merchInviteEmail({ name, heroUrl, orderLink, products = [] }) {
  const firstName = String(name || '').trim().split(/\s+/)[0] || 'there';

  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Preserve line breaks in product descriptions (escape first, then convert
  // newlines to <br> so raw HTML can't sneak in through the replacement).
  const escapeHtmlMultiline = (s) => escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>');

  const formatPrice = (price) => {
    const n = Number(price);
    return `PHP ${Number.isFinite(n) ? n.toLocaleString() : escapeHtml(price)}`;
  };

  const productRows = products.map((p, i) => {
    const image = Array.isArray(p.images) ? p.images[0] : p.image || p.image_url;
    const isLast = i === products.length - 1;
    return `
  <table class="product-block" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td>
      ${image ? `<img class="product-photo" src="${escapeHtml(image)}" alt="${escapeHtml(p.name)}">` : ''}
    </td></tr>
    <tr><td class="product-info" align="center">
      <p class="product-name">${escapeHtml(p.name)}</p>
      ${p.description ? `<p class="product-desc">${escapeHtmlMultiline(p.description)}</p>` : ''}
      <span class="product-price">${formatPrice(p.price)}</span>
      <a href="${orderLink}" style="display:inline-block;margin-left:8px;padding:4px 16px;border-radius:20px;font-size:13px;font-weight:700;text-decoration:none;color:#ffffff;background-color:#2E7048;background-image:linear-gradient(135deg,#2E7048,#4BAE6A);vertical-align:middle;">Pre-Order</a>
    </td></tr>
  </table>
  ${isLast ? '' : '<hr class="divider">'}`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Merch Preorders Are Open — RELAY 2026</title>
<style>
  body { font-family: Arial, sans-serif; background: #F2F5F8; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .bar { height: 4px; background: linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A); }
  .hero-img { width: 100%; display: block; }
  .header { background: linear-gradient(135deg,#1C2B38,#2E7048); padding: 34px 32px; text-align: center; }
  .header h1 { color: #fff; font-size: 26px; margin: 0; letter-spacing: -.01em; }
  .header p { color: rgba(255,255,255,0.65); font-size: 13px; margin: 8px 0 0; }
  .intro { padding: 28px 32px 6px; }
  .section-title { font-size: 19px; font-weight: 800; color: #1C2B38; text-align: center; margin: 0 0 20px; }
  .product-block { padding: 0 24px; margin-bottom: 22px; }
  .product-photo { width: 100%; display: block; border-radius: 12px; }
  .product-info { padding: 14px 8px 4px; text-align: center; }
  .product-name { font-size: 16px; font-weight: 800; color: #1C2B38; margin: 0 0 4px; }
  .product-desc { font-size: 12.5px; color: #6B8A9A; margin: 0 0 8px; line-height: 1.5; }
  .product-price { display: inline-block; font-size: 13.5px; font-weight: 800; color: #fff; background: #3A8BBF; border-radius: 20px; padding: 4px 14px; }
  .divider { border: none; border-top: 1px solid #E9EEF1; margin: 4px 40px 22px; }
  .note { background: #FDF6E0; border-left: 3px solid #E8B830; border-radius: 0 8px 8px 0; padding: 12px 16px; font-size: 13px; color: #7A5A10; line-height: 1.6; margin: 4px 32px 24px; }
  .cta-wrap { text-align: center; margin: 4px 0 16px; }
  .link-fallback { font-size: 11px; color: #6B8A9A; text-align: center; line-height: 1.6; padding: 0 32px 28px; }
  .footer { background: #f7fafb; padding: 16px 32px; text-align: center; font-size: 11px; color: #6B8A9A; border-top: 1px solid #D4E2EA; }
</style>
</head>
<body>
<div class="wrap">
  <div class="bar"></div>
  <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
  <div class="header">
    <h1>Merch Preorders Are Open 🛍️</h1>
    <p>RELAY Conference Asia Pacific 2026</p>
    <p style="display:inline-block;margin-top:12px;padding:6px 16px;border-radius:20px;background:rgba(232,184,48,0.18);border:1px solid #E8B830;color:#F5D77A;font-size:13px;font-weight:700;">⏰ Pre-order window: September 1&ndash;8, 2026</p>
  </div>

  <div class="intro">
    <p style="font-size:15px;color:#2A3D4A;margin-bottom:12px;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
    <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:12px;">
      Your RELAY 2026 conference payment is confirmed! 🎉 
    </p>
    <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:12px;">
      Now, it's time to get your official RELAY 2026 gear. 🛍️
    </p>
    <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:12px;">
      Secure your favorite RELAY 2026 gear by placing your pre-order through our <a href="${orderLink}" style="color:#2E7048;text-decoration:underline;">website</a> from <b>September 1&ndash;8, 2026</b>.
    </p>
    <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:12px;">
      Missed the pre-order deadline or weren’t able to submit your order through the website? No worries — you'll still be able to purchase RELAY 2026 gear on the day of the event, subject to availability.
    </p>
    <p style="font-size:14px;color:#2A3D4A;line-height:1.7;margin-bottom:12px;">
      ⏰ Don't wait until event day! Pre-order now to secure the items and sizes you want — once pre-orders close, your preferred gear may no longer be available.
    </p>
  </div>

  <!-- Product showcase -->
  <!-- p class="section-title">Get your RELAY 2026 gear</!-->
  ${productRows}

  <div class="note">This preorder page is only available through your confirmed-participant link.</div>

  <div class="cta-wrap">
    <a href="${orderLink}" style="display:inline-block;padding:15px 40px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;color:#ffffff;background-color:#2E7048;background-image:linear-gradient(135deg,#2E7048,#4BAE6A);">Open Merch Preorder</a>
  </div>
  <p class="link-fallback">Button not working? Copy this link:<br>${orderLink}</p>

  <div class="footer">RELAY 2026 &middot; Sovereign Grace Churches Asia Pacific &middot; Questions? Reply to this email.</div>
</div>
</body>
</html>`;
}

function partialPaymentEmail({ primaryName, amount, date, payment_method, totalFee, newPartialTotal, remaining, isGroup, heroUrl, siteUrl, registrationId, group_id }) {
  const uploadLink  = `${siteUrl}/upload-receipt?id=${registrationId}${isGroup && group_id ? `&group_id=${group_id}` : ''}`;
  const methodLabel = payment_method === 'gcash' ? 'GCash' : 'Cash';
  const paidPct     = Math.min(100, Math.round((newPartialTotal / totalFee) * 100));
  const [yr, mo, dy] = date.split('-');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateLabel = `${months[parseInt(mo,10)-1]} ${parseInt(dy,10)}, ${yr}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;background:#F2F5F8;margin:0;padding:0;}
    .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
    .bar{height:4px;background:linear-gradient(90deg,#4BAE6A,#3A8BBF,#E8B830,#4BAE6A);}
    .hero-img{width:100%;display:block;}
    .header{background:linear-gradient(135deg,#1C2B38,#6D28D9);padding:28px 32px;text-align:center;}
    .header h1{color:#fff;font-size:22px;margin:0;}
    .header p{color:rgba(255,255,255,0.65);font-size:13px;margin:6px 0 0;}
    .body{padding:32px;}
    .note{background:#EDE9FE;border-left:3px solid #6D28D9;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#4C1D95;line-height:1.6;margin:16px 0;}
    .note-green{background:#EAF5EE;border-left:3px solid #2E7048;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#2E7048;line-height:1.6;margin:16px 0;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>Partial Payment Received 💰</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${primaryName}</strong>, we've received your partial payment. Here's a summary:</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin-bottom:20px;">
        <thead><tr style="background:#f7fafb;"><th colspan="2" style="padding:10px 14px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;text-align:left;border-bottom:1px solid #D4E2EA;">Payment Details</th></tr></thead>
        <tbody>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Amount Paid</td><td style="padding:10px 14px;font-size:14px;font-weight:700;color:#6D28D9;border-bottom:1px solid #D4E2EA;">PHP ${amount.toLocaleString()}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Date</td><td style="padding:10px 14px;font-size:13px;color:#2A3D4A;border-bottom:1px solid #D4E2EA;">${dateLabel}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Method</td><td style="padding:10px 14px;font-size:13px;color:#2A3D4A;border-bottom:1px solid #D4E2EA;">${methodLabel}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#6B8A9A;border-bottom:1px solid #D4E2EA;">Total Paid So Far</td><td style="padding:10px 14px;font-size:13px;font-weight:600;color:#2A3D4A;border-bottom:1px solid #D4E2EA;">PHP ${newPartialTotal.toLocaleString()} of PHP ${totalFee.toLocaleString()}</td></tr>
          <tr style="background:#f7fafb;"><td style="padding:10px 14px;font-size:13px;font-weight:700;color:#2A3D4A;">Remaining Balance</td><td style="padding:10px 14px;font-size:14px;font-weight:700;color:${remaining <= 0 ? '#2E7048' : '#C0392B'};">${remaining <= 0 ? '✅ Fully Paid' : 'PHP ' + remaining.toLocaleString()}</td></tr>
        </tbody>
      </table>
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#6B8A9A;margin-bottom:6px;"><span>Payment Progress</span><span>${paidPct}%</span></div>
        <div style="background:#EDE9FE;border-radius:50px;height:8px;overflow:hidden;"><div style="width:${paidPct}%;height:8px;background:linear-gradient(90deg,#6D28D9,#8B5CF6);border-radius:50px;"></div></div>
      </div>
      ${remaining > 0
        ? `<div class="note">You still have a remaining balance of <strong>PHP ${remaining.toLocaleString()}</strong>. Please complete your payment as soon as possible to secure your slot.<br><br><a href="${uploadLink}" style="display:inline-block;margin-top:8px;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;color:#fff;background:#6D28D9;">📎 Submit Next Payment Receipt</a></div>`
        : `<div class="note-green">Your payment is now complete! Our team will verify and confirm your registration shortly.</div>`}
    </div>
    <div class="footer">RELAY 2026 · Sovereign Grace Churches Asia Pacific · CCT Tagaytay · Sept 23–26, 2026</div>
  </div></body></html>`;
}

function confirmationEmail(primaryReg, allMembers, totalLabel, heroUrl, isGroup) {
  const breakdownRows = allMembers.map(m => `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;">${m.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:#2A3D4A;text-align:center;">${m.student_status === 'student' ? 'Student' : 'Non-Student'}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#2A3D4A;text-align:right;">${m.student_status === 'student' ? 'PHP 3,000' : 'PHP 4,500'}</td>
    </tr>`).join('');

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
    hr{border:none;border-top:1px solid #D4E2EA;margin:20px 0;}
    .info-box{background:#EBF5FB;border-radius:10px;padding:16px 20px;font-size:13px;color:#2A3D4A;line-height:1.8;}
    .footer{background:#f7fafb;padding:16px 32px;text-align:center;font-size:11px;color:#6B8A9A;border-top:1px solid #D4E2EA;}
  </style></head><body><div class="wrap">
    <div class="bar"></div>
    <img src="${heroUrl}" alt="RELAY 2026" class="hero-img">
    <div class="header"><h1>${isGroup ? 'Your group is confirmed! 🎉' : "You're confirmed! 🎉"}</h1><p>RELAY Conference Asia Pacific 2026</p></div>
    <div class="body">
      <p style="font-size:15px;color:#2A3D4A;margin-bottom:20px;">Hi <strong>${primaryReg.name}</strong>, your payment has been verified and ${isGroup ? 'all participants are' : 'your registration is'} confirmed!</p>
      <div class="highlight"><h2>Registration Confirmed ✅</h2><p>${isGroup ? `${allMembers.length} participants · Slots reserved` : 'Your slot is reserved for RELAY 2026'}</p></div>
      <div style="margin-bottom:4px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;">Church</div>
      <div style="font-size:14px;color:#2A3D4A;margin-bottom:16px;">${primaryReg.church}</div>
      ${isGroup ? `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D4E2EA;border-radius:10px;overflow:hidden;margin-bottom:16px;">
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
        </table>` : `
        <div style="margin-bottom:4px;font-size:10px;font-weight:700;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.08em;">Amount Paid</div>
        <div style="font-size:14px;color:#2A3D4A;margin-bottom:16px;">${totalLabel}</div>`}
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