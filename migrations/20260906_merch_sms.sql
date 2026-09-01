-- Merch preorder invite SMS gets its own master switch and template,
-- deliberately separate from the general sms_enabled toggle and the other
-- per-event SMS settings — configured under Merch Settings in the admin
-- panel rather than the Site Settings SMS section.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS merch_sms_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merch_sms_template TEXT;
