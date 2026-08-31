-- Migration: Add an optional description field to merch products, shown
-- on the preorder page (product list and the image carousel modal).
ALTER TABLE public.merch_products
  ADD COLUMN IF NOT EXISTS description TEXT;
