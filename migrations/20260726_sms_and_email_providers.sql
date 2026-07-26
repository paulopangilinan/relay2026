-- Migration: 2026-07-26
-- 1. SMS notification settings (Semaphore) on site_settings
-- 2. sms_log table for delivery auditing / credit tracking
--
-- Defaults: SMS master switch OFF. When switched on, follow-up and cancellation
-- notices are enabled; confirmation and new-registration are opt-in so credit
-- usage stays predictable.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS sms_enabled         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_on_followup     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_on_cancelled    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_on_confirmed    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_on_registration BOOLEAN NOT NULL DEFAULT false;

-- ── SMS delivery log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID REFERENCES public.registrations(id) ON DELETE SET NULL,
  group_id        UUID,
  event           TEXT NOT NULL,           -- followup | cancelled | confirmed | registration
  mobile          TEXT,                    -- normalized 639XXXXXXXXX, or the raw value when skipped
  message         TEXT,
  segments        INT  DEFAULT 1,          -- 160-char segments = Semaphore credits charged
  status          TEXT NOT NULL,           -- sent | failed | skipped
  detail          TEXT,                    -- provider message id, skip reason, or error text
  triggered_by    TEXT,                    -- admin email, or 'system' for public form submits
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_log_registration_idx ON public.sms_log (registration_id);
CREATE INDEX IF NOT EXISTS sms_log_created_at_idx   ON public.sms_log (created_at DESC);

-- Only reachable through the service role key (same posture as public.admins).
ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;
