-- Round 112: admin switch to turn the food QR/passcode block off in the
-- registration-received and payment-confirmed emails. Defaults false per
-- explicit request — codes stay OFF by default until an admin opts in.
-- Does not affect the standalone food-code email/blast (Round 111), which
-- exists specifically to send the code and always includes it.

ALTER TABLE public.site_settings
  ADD COLUMN gathering_food_code_in_email_enabled BOOLEAN NOT NULL DEFAULT false;
