// netlify/functions/site-settings.js
// GET → registration open/closed flags (public)
//       + notification settings & provider status when an admin token is sent
// PUT → update settings (super admin only)

import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_TEXT_DEFAULTS } from '../lib/notification-settings.js';
import { smsConfigured, smsReady, smsSenderName, getSMSAccount, getSenderNames } from '../lib/sms.js';
import { resendConfigured } from '../lib/mailer.js';
import { smsEventCatalogue, replyNumber } from '../lib/sms-templates.js';

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers    = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'relay2026secret';

const NOTIFICATION_KEYS = Object.keys(NOTIFICATION_DEFAULTS);
const TEXT_KEYS         = Object.keys(NOTIFICATION_TEXT_DEFAULTS);

// Roughly 10 credits — enough for a long notice, low enough that a paste
// accident can't quietly burn the balance across a whole bulk run.
const MAX_TEMPLATE_LENGTH = 1600;

function getAdmin(event) {
  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  if (event.httpMethod === 'GET') {
    const requester = getAdmin(event);

    // Notification columns arrive across two migrations. Step down one tier at
    // a time so a half-migrated database still reports everything it does have,
    // instead of collapsing all the way back to the registration flags.
    const MERCH_COLS = ['merch_preorder_closed', 'merch_downpayment_percent'];
    const BASE_COLS = ['reg_ph_closed', 'reg_intl_closed', 'ph_pay_later_enabled', ...MERCH_COLS];
    const TIERS = [
      [...BASE_COLS, ...NOTIFICATION_KEYS, ...TEXT_KEYS],   // fully migrated
      [...BASE_COLS, ...NOTIFICATION_KEYS],                 // with notification keys
      BASE_COLS,                                            // base only
      ['reg_ph_closed', 'reg_intl_closed', 'ph_pay_later_enabled'], // fallback before merch migration
    ];

    let data = null, migrationPending = false;
    for (let tier = 0; tier < TIERS.length; tier++) {
      const res = await supabase
        .from('site_settings')
        .select(TIERS[tier].join(', '))
        .eq('id', true)
        .maybeSingle();
      if (!res.error && res.data) { data = res.data; migrationPending = tier > 0; break; }
    }

    // Public callers (registration and merch preorder pages) only need a small subset of flags.
    if (!requester) {
      if (!data) return {
        statusCode: 200, headers,
        body: JSON.stringify({
          reg_ph_closed: false, reg_intl_closed: false, ph_pay_later_enabled: false,
          merch_preorder_closed: false, merch_downpayment_percent: 0,
        })
      };
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          reg_ph_closed: !!data.reg_ph_closed,
          reg_intl_closed: !!data.reg_intl_closed,
          ph_pay_later_enabled: !!data.ph_pay_later_enabled,
          merch_preorder_closed: !!data.merch_preorder_closed,
          merch_downpayment_percent: data.merch_downpayment_percent !== undefined && data.merch_downpayment_percent !== null ? Number(data.merch_downpayment_percent) : 0,
        }),
      };
    }

    const settings = {
      reg_ph_closed:   !!data?.reg_ph_closed,
      reg_intl_closed: !!data?.reg_intl_closed,
      merch_preorder_closed: !!data?.merch_preorder_closed,
      merch_downpayment_percent: data?.merch_downpayment_percent !== undefined && data?.merch_downpayment_percent !== null ? Number(data.merch_downpayment_percent) : 0,
      ...NOTIFICATION_DEFAULTS,
      ...NOTIFICATION_TEXT_DEFAULTS,
      ...(data || {}),
    };

    // Balance and sender-name status are best-effort extras — never let them
    // fail the request. Both only matter once SMS is switched on.
    const [sms_account, sms_sender_names] = settings.sms_enabled
      ? await Promise.all([getSMSAccount(), getSenderNames()])
      : [null, null];

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        ...settings,
        providers: {
          sms_configured:    smsConfigured(),
          sms_ready:         smsReady(),
          resend_configured: resendConfigured(),
        },
        sms_account,
        sms_sender_names,
        sms_sender_configured: process.env.SEMAPHORE_SENDER_NAME || null,
        migration_pending: migrationPending,
        // One editor panel per event; each pre-fills with its default when
        // nothing is stored yet.
        sms_events:       smsEventCatalogue(),
        sms_reply_number: replyNumber(),
        sms_template_max: MAX_TEMPLATE_LENGTH,
        // Real-world length so the editor's credit counter isn't optimistic.
        sms_sample_link:  `${(process.env.SITE_URL || '').replace(/\/+$/, '')}/upload-receipt?id=3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`,
      }),
    };
  }

  if (event.httpMethod === 'PUT') {
    const requester = getAdmin(event);
    if (!requester)                return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!requester.is_super_admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Super admin only' }) };

    try {
      const body = JSON.parse(event.body);

      // Only ever write known columns — anything else in the payload is ignored.
      const patch = { id: true, updated_at: new Date().toISOString() };
      for (const key of ['reg_ph_closed', 'reg_intl_closed', 'ph_pay_later_enabled', 'merch_preorder_closed', ...NOTIFICATION_KEYS]) {
        if (key in body) patch[key] = !!body[key];
      }
      if ('merch_downpayment_percent' in body) {
        const num = parseInt(body.merch_downpayment_percent, 10);
        patch.merch_downpayment_percent = isNaN(num) ? 0 : Math.max(0, Math.min(100, num));
      }
      for (const key of TEXT_KEYS) {
        if (!(key in body)) continue;
        const value = typeof body[key] === 'string' ? body[key].trim() : '';
        if (value.length > MAX_TEMPLATE_LENGTH) {
          return {
            statusCode: 400, headers,
            body: JSON.stringify({ error: `Message is too long — keep it under ${MAX_TEMPLATE_LENGTH} characters.` }),
          };
        }
        patch[key] = value || null;   // blank resets to the built-in default
      }

      const { error } = await supabase.from('site_settings').upsert(patch);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
