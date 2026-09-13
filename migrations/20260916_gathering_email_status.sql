-- Tracks delivery outcome for all 3 participant-facing Gathering emails
-- (registration-received, payment-confirmed, cancellation), so the admin
-- panel can show a real sent/failed indicator and offer a Resend button
-- instead of relying on Netlify function logs to know whether an email
-- actually went out.

ALTER TABLE public.gathering_registrations
  ADD COLUMN IF NOT EXISTS registration_email_status text,
  ADD COLUMN IF NOT EXISTS registration_email_provider text,
  ADD COLUMN IF NOT EXISTS registration_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_email_status text,
  ADD COLUMN IF NOT EXISTS payment_confirmed_email_provider text,
  ADD COLUMN IF NOT EXISTS payment_confirmed_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_email_status text,
  ADD COLUMN IF NOT EXISTS cancellation_email_provider text,
  ADD COLUMN IF NOT EXISTS cancellation_email_sent_at timestamptz;
