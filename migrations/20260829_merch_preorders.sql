CREATE TABLE IF NOT EXISTS public.merch_preorders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  email            TEXT NOT NULL,
  church           TEXT,
  items            JSONB NOT NULL,
  total_amount     INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('submitted','confirmed','cancelled','fulfilled')),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merch_preorders_registration_id_idx
  ON public.merch_preorders(registration_id);

ALTER TABLE public.merch_preorders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages merch_preorders" ON public.merch_preorders;
CREATE POLICY "Service role manages merch_preorders"
  ON public.merch_preorders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
