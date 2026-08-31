-- Migration: Add on/off switch for merch order admin email notifications
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS merch_order_email_notify BOOLEAN NOT NULL DEFAULT true;
