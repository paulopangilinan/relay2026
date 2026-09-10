-- Makes the email provider used for Gathering Around the Gospel emails
-- (admin new-registration notify, participant registration-received,
-- participant payment-confirmed) configurable from admin Settings instead
-- of hardcoded. Defaults to 'resend', matching the current hardcoded
-- behavior — this migration changes nothing about default behavior, only
-- makes it switchable without a redeploy.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS gathering_email_provider TEXT NOT NULL DEFAULT 'resend'
    CHECK (gathering_email_provider IN ('gmail', 'resend'));
