-- Migration: 2026-07-27 (b)
-- One editable SMS body per notification event, managed from Admin → Site Settings.
-- The follow-up column arrived in 20260727_sms_followup_template.sql; this adds
-- the remaining three. NULL means "use the built-in default"
-- (see netlify/lib/sms-templates.js).

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS sms_followup_template     TEXT,
  ADD COLUMN IF NOT EXISTS sms_cancelled_template    TEXT,
  ADD COLUMN IF NOT EXISTS sms_confirmed_template    TEXT,
  ADD COLUMN IF NOT EXISTS sms_registration_template TEXT;
