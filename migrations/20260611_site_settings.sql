-- Migration: add site_settings table for registration open/closed toggles

CREATE TABLE IF NOT EXISTS public.site_settings (
  id               BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  reg_ph_closed    BOOLEAN NOT NULL DEFAULT false,
  reg_intl_closed  BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.site_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow select site_settings" ON public.site_settings FOR SELECT USING (true);
