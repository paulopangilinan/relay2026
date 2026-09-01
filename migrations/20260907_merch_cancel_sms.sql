-- Order Cancellation SMS notification, sent when an admin cancels a merch
-- preorder. Own dedicated switch + template, same pattern as
-- merch_complete_sms_enabled — kept independent of the shared sms_enabled
-- gate and the other merch SMS switches.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS merch_cancel_sms_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merch_cancel_sms_template TEXT;
