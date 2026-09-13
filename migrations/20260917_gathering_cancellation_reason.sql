-- Fixed-set cancellation reason (chosen from a dropdown in admin, not
-- free text) — drives which cancellation email body gets sent. See
-- GATHERING_CANCELLATION_REASONS in netlify/lib/gathering-email.js for the
-- valid keys: duplicate, cant_confirm_payment, registrant_requested, other.

ALTER TABLE public.gathering_registrations
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
