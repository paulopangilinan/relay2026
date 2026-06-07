-- Migration: 2026-06-07
-- Add partial payment support

-- ── New column on registrations ───────────────────────────────────────────────
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS partial_paid_total INTEGER DEFAULT 0;

-- ── Expand status constraint to include partially_paid ────────────────────────
ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_status_check;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_status_check
  CHECK (status IN ('awaiting_payment','payment_pending_review','confirmed','cancelled','partially_paid'));

-- ── Partial payments ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partial_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL,
  group_id        UUID,
  date            DATE NOT NULL,
  amount          INTEGER NOT NULL,
  payment_method  TEXT CHECK (payment_method IN ('gcash', 'cash')),
  notes           TEXT,
  recorded_by     TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.partial_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select partial_payments"
  ON public.partial_payments FOR SELECT USING (true);

-- ── Data API grants ───────────────────────────────────────────────────────────
GRANT SELECT ON public.partial_payments TO anon, authenticated;
