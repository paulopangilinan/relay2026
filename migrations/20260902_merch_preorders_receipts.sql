-- Add receipt and payment tracking to merch_preorders
ALTER TABLE public.merch_preorders
  ADD COLUMN IF NOT EXISTS deposit_amount INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS receipt_path TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','uploaded','verified','rejected'));

-- Backfill defaults
UPDATE public.merch_preorders SET deposit_amount = 0 WHERE deposit_amount IS NULL;
UPDATE public.merch_preorders SET payment_status = 'pending' WHERE payment_status IS NULL;
