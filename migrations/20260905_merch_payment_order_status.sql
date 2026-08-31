-- Redefine merch_preorders' two status fields around a clearer split:
--   payment_status: 'unpaid' | 'partial' | 'paid' | 'cancelled'
--   status (order):  'pending' | 'completed' | 'cancelled'
-- Also disables the down-payment requirement for now (no payment method is
-- configured yet), so new orders don't get stuck asking for a deposit.

-- 1. Drop the old CHECK constraints (auto-named from the original inline
--    CHECK clauses) before touching any data, so the backfill below isn't
--    rejected mid-way.
ALTER TABLE public.merch_preorders DROP CONSTRAINT IF EXISTS merch_preorders_status_check;
ALTER TABLE public.merch_preorders DROP CONSTRAINT IF EXISTS merch_preorders_payment_status_check;

-- 2. Backfill existing rows into the new domains.
UPDATE public.merch_preorders SET status = CASE status
  WHEN 'submitted' THEN 'pending'
  WHEN 'confirmed' THEN 'completed'
  WHEN 'fulfilled' THEN 'completed'
  WHEN 'cancelled' THEN 'cancelled'
  ELSE 'pending'
END;

UPDATE public.merch_preorders SET payment_status = CASE payment_status
  WHEN 'pending'  THEN 'unpaid'
  WHEN 'uploaded' THEN 'partial'
  WHEN 'verified' THEN 'paid'
  WHEN 'rejected' THEN 'unpaid'
  ELSE 'unpaid'
END;

-- A cancelled order's payment is considered cancelled too, matching the new
-- "Cancel Order" behavior going forward.
UPDATE public.merch_preorders SET payment_status = 'cancelled' WHERE status = 'cancelled';

-- 3. New defaults + constraints.
ALTER TABLE public.merch_preorders ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.merch_preorders ALTER COLUMN payment_status SET DEFAULT 'unpaid';

ALTER TABLE public.merch_preorders
  ADD CONSTRAINT merch_preorders_status_check
  CHECK (status IN ('pending','completed','cancelled'));

ALTER TABLE public.merch_preorders
  ADD CONSTRAINT merch_preorders_payment_status_check
  CHECK (payment_status IN ('unpaid','partial','paid','cancelled'));

-- 4. Down payment is disabled for now — no payment method is configured, so
--    default and current value both go to 0 (0% = no deposit required).
ALTER TABLE public.site_settings ALTER COLUMN merch_downpayment_percent SET DEFAULT 0;
UPDATE public.site_settings SET merch_downpayment_percent = 0;
