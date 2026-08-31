-- Migration: snapshot the down-payment percent that was in effect when each
-- merch preorder was placed, so a later change to the global DP% setting
-- doesn't retroactively change what a past order required.
ALTER TABLE public.merch_preorders
  ADD COLUMN IF NOT EXISTS dp_percent INTEGER;
