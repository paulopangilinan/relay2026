-- Adds 'cancelled' as a valid gathering_registrations.payment_status, for
-- GCash registrations whose receipt can't be verified (no actual payment
-- attached, wrong amount, unreadable image, etc.) — an alternative to
-- Confirm for pending_review rows that shouldn't just sit there forever.

ALTER TABLE public.gathering_registrations
  DROP CONSTRAINT IF EXISTS gathering_registrations_payment_status_check;

ALTER TABLE public.gathering_registrations
  ADD CONSTRAINT gathering_registrations_payment_status_check
  CHECK (payment_status IN ('unpaid', 'pending_review', 'confirmed', 'cancelled'));
