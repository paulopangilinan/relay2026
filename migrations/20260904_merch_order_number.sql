-- Migration: Human-friendly sequential Order ID for merch preorders
-- (displayed/formatted in the app as e.g. RLY-00001, instead of the raw UUID)
CREATE SEQUENCE IF NOT EXISTS public.merch_preorders_order_seq;

ALTER TABLE public.merch_preorders
  ADD COLUMN IF NOT EXISTS order_number INTEGER;

-- Backfill any existing rows in creation order before enforcing NOT NULL —
-- the sequence default below only applies to rows inserted after this point.
DO $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM public.merch_preorders WHERE order_number IS NULL ORDER BY created_at ASC LOOP
    n := n + 1;
    UPDATE public.merch_preorders SET order_number = n WHERE id = r.id;
  END LOOP;
  PERFORM setval('public.merch_preorders_order_seq', GREATEST(n, 1));
END $$;

ALTER TABLE public.merch_preorders
  ALTER COLUMN order_number SET DEFAULT nextval('public.merch_preorders_order_seq'),
  ALTER COLUMN order_number SET NOT NULL;

ALTER SEQUENCE public.merch_preorders_order_seq OWNED BY public.merch_preorders.order_number;

CREATE UNIQUE INDEX IF NOT EXISTS merch_preorders_order_number_idx
  ON public.merch_preorders(order_number);
