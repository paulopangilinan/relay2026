CREATE TABLE IF NOT EXISTS public.merch_products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  price          INTEGER NOT NULL DEFAULT 0,
  sizes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  purchase_limit INTEGER NOT NULL DEFAULT 1,
  images         JSONB NOT NULL DEFAULT '[]'::jsonb,
  availability   TEXT,
  sold_out       BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merch_products_active_sort_idx
  ON public.merch_products(is_active, sort_order, name);

ALTER TABLE public.merch_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active merch_products" ON public.merch_products;
CREATE POLICY "Public read active merch_products"
  ON public.merch_products
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Service role manages merch_products" ON public.merch_products;
CREATE POLICY "Service role manages merch_products"
  ON public.merch_products
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.merch_products
  (name, price, sizes, purchase_limit, images, availability, sold_out, is_active, sort_order)
VALUES
  ('RELAY Conference Shirt', 650, '["XS","S","M","L","XL","2XL","3XL"]'::jsonb, 2, '[]'::jsonb, 'Available for preorder', false, true, 10),
  ('RELAY Canvas Tote', 350, '[]'::jsonb, 2, '[]'::jsonb, 'Available for preorder', false, true, 20),
  ('RELAY Notebook', 250, '[]'::jsonb, 3, '[]'::jsonb, 'Available for preorder', false, true, 30)
ON CONFLICT DO NOTHING;
