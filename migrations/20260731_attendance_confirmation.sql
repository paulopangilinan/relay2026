-- Migration: 2026-07-31
-- Pre-conference attendance confirmation for the Aspiring Leader Pre-Conference
-- Sessions (Sept 23, 2026). PH male participants only.
--
-- gender is deliberately nullable with no default: it is set explicitly, either
-- by the registrant on the form or by an admin in the backfill panel. Nothing is
-- ever inferred into this column — a name-based guess resolves under half of our
-- registrants and misfires on unisex names, so it may inform an admin's choice
-- but must never decide who gets contacted.

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS gender                  TEXT,
  ADD COLUMN IF NOT EXISTS attendance_response     TEXT,
  ADD COLUMN IF NOT EXISTS attendance_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_invited_at   TIMESTAMPTZ;

-- Guard the enums. Added separately so re-running the file is safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_gender_check') THEN
    ALTER TABLE public.registrations
      ADD CONSTRAINT registrations_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_attendance_response_check') THEN
    ALTER TABLE public.registrations
      ADD CONSTRAINT registrations_attendance_response_check
      CHECK (attendance_response IS NULL OR attendance_response IN ('attending', 'not_attending'));
  END IF;
END $$;

-- The send targets male + paid, and the dashboard filters on the response.
CREATE INDEX IF NOT EXISTS registrations_gender_status_idx
  ON public.registrations (gender, status)
  WHERE registrant_type IS DISTINCT FROM 'international';

CREATE INDEX IF NOT EXISTS registrations_attendance_response_idx
  ON public.registrations (attendance_response);

-- ── Attendance SMS event ─────────────────────────────────────────────────────
-- Fifth notification event, on by default: an attendance request that arrives
-- by email alone is easy to miss, and the SMS is what points people at it.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS sms_on_attendance       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_attendance_template TEXT;
