// netlify/lib/notification-settings.js
// Reads the SMS notification switches off site_settings.
// Any read failure (missing row, migration not yet applied) degrades to the
// defaults below rather than breaking the calling flow.

export const NOTIFICATION_DEFAULTS = {
  sms_enabled:         false,
  sms_on_followup:         true,
  sms_on_followup_partial: true,
  sms_on_cancelled:    true,
  sms_on_confirmed:    false,
  sms_on_registration: false,
  sms_on_attendance:   true,
};

// Free-text columns are kept apart from the boolean switches because the
// settings endpoint coerces the booleans with !! and must not touch these.
// null → fall back to that event's built-in default in sms-templates.js
export const NOTIFICATION_TEXT_DEFAULTS = {
  sms_followup_template:         null,
  sms_followup_partial_template: null,
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
    // Deliberately `*` rather than a column list. Naming a column that a
    // not-yet-applied migration will create fails the entire query, and this
    // function sits on every send path — one missing column would silently
    // switch off follow-up, cancellation, confirmation and invite SMS at once,
    // with nothing to show for it. Selecting * cannot break on column drift in
    // either direction, so code and migration can ship in either order.
    const { data, error } = await supabase
      .from('site_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) {
      // A real read failure still degrades to "off", but says so in the logs
      // instead of looking like a deliberate configuration.
      if (error) console.error('[notifications] settings read failed, SMS disabled for this request:', error.message);
      return fallback;
    }
    // Copy across only the keys we know about: a missing column keeps its
    // default, and an unrelated column never leaks into an API response.
    const settings = { ...fallback };
    for (const key of Object.keys(fallback)) {
      if (key in data) settings[key] = data[key];
    }
    return settings;
  } catch (err) {
    console.error('[notifications] settings read threw, SMS disabled for this request:', err.message);
    return fallback;
  }
}

/** Master switch AND the per-event switch must both be on. */
export function smsAllowed(settings, event) {
  if (!settings?.sms_enabled) return false;
  return !!settings[`sms_on_${event}`];
}
