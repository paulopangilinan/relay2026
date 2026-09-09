-- Gathering Around the Gospel — lightweight sub-registration
-- Separate from `registrations` on purpose: this event only needs a name
-- and a headcount, and its payment lifecycle is different (venue payments
-- are never "confirmed" through this form — only GCash is).

CREATE TABLE public.gathering_registrations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ DEFAULT now(),

  name               TEXT NOT NULL,
  participant_count  INTEGER NOT NULL DEFAULT 1 CHECK (participant_count > 0),

  payment_method     TEXT NOT NULL CHECK (payment_method IN ('venue', 'gcash')),

  -- Snapshot of the fee rate at submission time. Never re-read from env
  -- after insert, so a later price change doesn't retroactively rebill
  -- people who already registered.
  fee_per_head       INTEGER NOT NULL,
  amount_due         INTEGER NOT NULL,

  receipt_url        TEXT,

  -- 'venue' registrations stay 'unpaid' forever through this system —
  -- actual confirmation happens at the door, not here.
  payment_status     TEXT NOT NULL DEFAULT 'unpaid'
                      CHECK (payment_status IN ('unpaid', 'pending_review', 'confirmed')),

  verified_at        TIMESTAMPTZ,
  verified_by        TEXT
);

ALTER TABLE public.gathering_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert" ON public.gathering_registrations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select" ON public.gathering_registrations FOR SELECT USING (true);
CREATE POLICY "Allow update" ON public.gathering_registrations FOR UPDATE USING (true);
