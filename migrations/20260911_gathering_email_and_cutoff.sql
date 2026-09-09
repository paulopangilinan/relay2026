-- Migration: email/mobile fields for Gathering registrations (for payment
-- confirmation emails + future SMS), plus a manual registration-closed
-- switch for the Gathering sub-site.

ALTER TABLE public.gathering_registrations
  ADD COLUMN email  TEXT NOT NULL DEFAULT '',
  ADD COLUMN mobile TEXT NOT NULL DEFAULT '';

-- DEFAULT '' only exists so this ALTER doesn't fail against any rows already
-- inserted during Round 1/2 testing (before email/mobile were collected).
-- New rows always go through submit-gathering.js, which requires both.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS reg_gathering_closed BOOLEAN NOT NULL DEFAULT false;
