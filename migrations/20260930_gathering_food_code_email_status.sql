-- Round 110: delivery tracking for the new standalone "food code" email
-- (per-row Resend icon + the "Send Food Codes to Everyone" blast), same
-- 3-column pattern as 20260916_gathering_email_status.sql for the other
-- three participant-facing Gathering emails.

ALTER TABLE public.gathering_registrations
  ADD COLUMN IF NOT EXISTS food_code_email_status text,
  ADD COLUMN IF NOT EXISTS food_code_email_provider text,
  ADD COLUMN IF NOT EXISTS food_code_email_sent_at timestamptz;
