-- Migration: 2026-07-27
-- Editable follow-up SMS body, managed from Admin → Site Settings.
-- NULL means "use the built-in default" (see netlify/lib/sms-templates.js).

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS sms_followup_template TEXT;
