-- Add stock tracking to merch_products
ALTER TABLE public.merch_products
  ADD COLUMN IF NOT EXISTS stock JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill existing products with empty stock if missing
UPDATE public.merch_products SET stock = '{}'::jsonb WHERE stock IS NULL;

-- Optional: if a product has sizes but no stock, set stock values to null (meaning unlimited)
-- Leave administrators to populate precise counts via the admin UI.
