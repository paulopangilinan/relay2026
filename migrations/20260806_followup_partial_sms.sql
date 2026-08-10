-- Migration: 2026-08-06
-- Payment follow-ups can now go to partially-paid registrants as well as
-- unpaid ones. They get their own message: telling someone who has already
-- paid something that "we have not yet received your payment" is wrong, and
-- the useful figure for them is the remaining balance, not the full fee.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS sms_on_followup_partial       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_followup_partial_template TEXT;
