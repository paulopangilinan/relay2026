// netlify/lib/notification-settings.js
// Reads the SMS notification switches off site_settings.
// Any read failure (missing row, migration not yet applied) degrades to the
// defaults below rather than breaking the calling flow.

export const NOTIFICATION_DEFAULTS = {
  sms_enabled:         false,
  sms_on_followup:     true,
  sms_on_cancelled:    true,
  sms_on_confirmed:    false,
  sms_on_registration: false,
  sms_on_attendance:   true,
};

// Free-text columns are kept apart from the boolean switches because the
// settings endpoint coerces the booleans with !! and must not touch these.
// null → fall back to that event's built-in default in sms-templates.js
export const NOTIFICATION_TEXT_DEFAULTS = {
  sms_followup_template:     null,
  sms_cancelled_template:    null,
  sms_confirmed_template:    null,
  sms_registration_template: null,
  sms_attendance_template:   null,
};

/** Body an event should send with, or undefined to use the built-in default. */
export function templateFor(settings, event) {
  return settings?.[`sms_${event}_template`] || undefined;
}

export async function getNotificationSettings(supabase) {
  const fallback = { ...NOTIFICATION_DEFAULTS, ...NOTIFICATION_TEXT_DEFAULTS };
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select([...Object.keys(NOTIFICATION_DEFAULTS), ...Object.keys(NOTIFICATION_TEXT_DEFAULTS)].join(', '))
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return fallback;
    return { ...fallback, ...data };
  } catch {
    return fallback;
  }
}

/** Master switch AND the per-event switch must both be on. */
export function smsAllowed(settings, event) {
  if (!settings?.sms_enabled) return false;
  return !!settings[`sms_on_${event}`];
}
