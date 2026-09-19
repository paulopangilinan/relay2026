-- Tracks that a registration's payment_confirmed email was the "Confirm
-- Partial Payment" variant (purple, admin-edited body) rather than the
-- normal one, and stores what's needed to regenerate that exact email on
-- a later resend — the admin's free-text body still has {name}/{amount}/
-- etc. tokens in it (unfilled), and submittedCount can't be recovered from
-- participant_count once that's been overwritten with the confirmed
-- (lower) count.
ALTER TABLE public.gathering_registrations
  ADD COLUMN IF NOT EXISTS confirmed_partial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partial_confirm_submitted_count INTEGER,
  ADD COLUMN IF NOT EXISTS partial_confirm_email_body TEXT;
