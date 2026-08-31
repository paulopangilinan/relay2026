-- Migration: Add Merch Preorder global settings
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS merch_preorder_closed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merch_downpayment_percent INTEGER NOT NULL DEFAULT 50;
