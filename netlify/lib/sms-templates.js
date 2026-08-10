// netlify/lib/sms-templates.js
// SMS bodies for each notification event.
//
// Every event's message is editable from Admin → Site Settings and stored on
// site_settings. A NULL/blank stored value falls back to the default below, so
// the system always has something valid to send.
//
// Semaphore charges one credit per 160 characters — keep defaults tight.

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

// Semaphore messages can't be replied to, so templates point at a real number
// instead. Defaults to the GCash contact number already in the env; set
// SMS_REPLY_NUMBER to route replies somewhere else.
export function replyNumber() {
  const raw = process.env.SMS_REPLY_NUMBER || process.env.GCASH_MOBILE || '';
  const digits = String(raw).replace(/\D/g, '');
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;   // +63 947 542 4079 → 09475424079
  if (/^09\d{9}$/.test(digits))  return digits;
  if (/^9\d{9}$/.test(digits))   return `0${digits}`;
  return raw.trim();
}

// ── Placeholder catalogue ─────────────────────────────────────────────────────
// Shown verbatim on the Site Settings page, so labels double as documentation.
const P = {
  name:      { token: '{name}',      label: 'First name',           example: 'Juan' },
  full_name: { token: '{full_name}', label: 'Full name',            example: 'Juan Dela Cruz' },
  amount:    { token: '{amount}',    label: 'Amount due',           example: 'PHP 4,500' },
  count:     { token: '{count}',     label: 'Number of participants', example: '3' },
  contact:   { token: '{contact}',   label: 'Number to text back',  example: '09475424079' },
  link:      { token: '{link}',      label: 'Receipt upload link',  example: 'https://…/upload-receipt?id=…' },
  paid:      { token: '{paid}',      label: 'Amount paid so far',   example: 'PHP 2,000' },
  balance:   { token: '{balance}',   label: 'Remaining balance',    example: 'PHP 2,500' },
};

// ── Per-event configuration ───────────────────────────────────────────────────
export const SMS_EVENT_CONFIG = {
  followup: {
    column:  'sms_followup_template',
    label:   'Payment follow-up is sent',
    tab:     'Follow-up',
    hint:    'Goes out with the reminder email.',
    tokens:  ['name', 'full_name', 'amount', 'count', 'contact', 'link'],
    default: `Hi {name},

The Asia-Pacific RELAY Conference 2026 is almost here!

Our records show that we have not yet received your registration payment. Please complete your payment by August 15, 2026. Unpaid registrations will be cancelled on August 16.

If you have already paid, please text {contact} so we can verify your payment.

Thank you! We look forward to seeing you at the conference.`,
  },

  followup_partial: {
    column:  'sms_followup_partial_template',
    label:   'Follow-up to a partially paid registrant',
    tab:     'Follow-up (partial)',
    hint:    'Used instead of the standard reminder when something has been paid.',
    tokens:  ['name', 'full_name', 'amount', 'paid', 'balance', 'count', 'contact', 'link'],
    // {amount} is the gross fee here, not what's still owed — an admin who
    // writes "Please settle {amount}" from the generic label would be asking a
    // partial payer for the full amount again. {balance} is the one they want.
    tokenLabels: { amount: 'Total fee — use {balance} for what is owed' },
    default: `Hi {name},

Thank you for your payment towards the Asia-Pacific RELAY Conference 2026. Our records show {paid} received, leaving a balance of {balance}.

Please settle the remaining amount by August 15, 2026 to secure your slot. Unpaid balances will be cancelled on August 16.

If you have already paid in full, please text {contact} so we can verify your payment.

Thank you! We look forward to seeing you at the conference.`,
  },

  cancelled: {
    column:  'sms_cancelled_template',
    label:   'A registration is cancelled',
    tab:     'Cancelled',
    hint:    'Only when "notify registrant" is on.',
    tokens:  ['name', 'full_name', 'count', 'contact'],
    default: `RELAY 2026: Hi {name}, your registration has been cancelled. If this was a mistake, please text {contact} so we can help.`,
  },

  confirmed: {
    column:  'sms_confirmed_template',
    label:   'Payment is confirmed',
    tab:     'Confirmed',
    hint:    'One SMS per confirmation, incl. email-link verifies.',
    tokens:  ['name', 'full_name', 'amount', 'count', 'contact'],
    default: `RELAY 2026: Hi {name}, your payment is verified and your slot is confirmed! Sept 23-26, CCT Tagaytay. See you there!`,
  },

  attendance: {
    column:  'sms_attendance_template',
    label:   'Pre-conference invitation is sent',
    tab:     'Pre-Con Invite',
    hint:    'Invites paid male participants to the pre-conference sessions.',
    tokens:  ['name', 'full_name', 'count', 'contact'],
    default: `Hi {name},

As part of the Asia-Pacific RELAY Conference 2026, male participants are invited to the Aspiring Leaders Pre-Conference Session on Sept 23, 2PM to 6PM.

Please let us know if you can join, using the link in your email. Check your inbox, junk or spam folder. Questions? Text {contact}.`,
  },

  registration: {
    column:  'sms_registration_template',
    label:   'A new registration comes in',
    tab:     'New registration',
    hint:    'Highest volume — one message per submission.',
    tokens:  ['name', 'full_name', 'amount', 'count', 'contact'],
    default: `RELAY 2026: Hi {name}, we received your registration ({amount}). Check your email for next steps. If you don't see it, look in your junk or spam folder.`,
  },
};

export const SMS_EVENTS = Object.keys(SMS_EVENT_CONFIG);

/** Everything the Site Settings editor needs to render one event's panel. */
export function smsEventCatalogue() {
  return SMS_EVENTS.map(event => ({
    event,
    column:       SMS_EVENT_CONFIG[event].column,
    label:        SMS_EVENT_CONFIG[event].label,
    hint:         SMS_EVENT_CONFIG[event].hint,
    default:      SMS_EVENT_CONFIG[event].default,
    // A token can mean something slightly different per event, so an event may
    // override the shared label without forking the catalogue.
    placeholders: SMS_EVENT_CONFIG[event].tokens.map(t => {
      const override = SMS_EVENT_CONFIG[event].tokenLabels?.[t];
      return override ? { ...P[t], label: override } : P[t];
    }),
  }));
}

// Unknown tokens are left untouched so a typo is visible in the preview
// rather than silently vanishing from the message.
export function fillPlaceholders(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

/**
 * Render one event's SMS.
 * @param {string} event    one of SMS_EVENTS
 * @param {object} vars     { name, totalLabel, count, uploadLink }
 * @param {string} [template] admin-edited body; blank/absent uses the default
 */
export function renderEventSMS(event, vars = {}, template) {
  const config = SMS_EVENT_CONFIG[event];
  if (!config) throw new Error(`Unknown SMS event: ${event}`);

  const tpl = (typeof template === 'string' && template.trim()) ? template : config.default;
  return fillPlaceholders(tpl, {
    name:      firstName(vars.name),
    full_name: String(vars.name || '').trim(),
    amount:    vars.totalLabel || '',
    paid:      vars.paidLabel || '',
    balance:   vars.balanceLabel || '',
    count:     String(vars.count ?? 1),
    contact:   replyNumber(),
    link:      vars.uploadLink || '',
  });
}

// Named wrappers keep the call sites readable.
export const followUpSMS     = ({ name, totalLabel, count, uploadLink, template }) =>
  renderEventSMS('followup', { name, totalLabel, count, uploadLink }, template);

export const followUpPartialSMS = ({ name, totalLabel, paidLabel, balanceLabel, count, uploadLink, template }) =>
  renderEventSMS('followup_partial', { name, totalLabel, paidLabel, balanceLabel, count, uploadLink }, template);

export const attendanceSMS   = ({ name, count, template }) =>
  renderEventSMS('attendance', { name, count }, template);

export const cancelledSMS    = ({ name, count, template }) =>
  renderEventSMS('cancelled', { name, count }, template);

export const confirmedSMS    = ({ name, totalLabel, count, template }) =>
  renderEventSMS('confirmed', { name, totalLabel, count }, template);

export const registrationSMS = ({ name, totalLabel, count, template }) =>
  renderEventSMS('registration', { name, totalLabel, count }, template);
