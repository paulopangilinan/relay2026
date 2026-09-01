-- Migration: Order Confirmation (formerly "Complete Order") SMS notification.
-- Own dedicated switch + template, same pattern as merch_sms_enabled for
-- the preorder invite — kept independent of the shared sms_enabled gate.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS merch_complete_sms_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merch_complete_sms_template TEXT;
