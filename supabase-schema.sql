-- ============================================================
-- RELAY Conference 2026 — Supabase Schema
-- Clean production script — run once on a fresh database
-- ============================================================

-- ── Drop existing tables (clean slate) ───────────────────────────────────────
DROP TABLE IF EXISTS public.registrations CASCADE;
DROP TABLE IF EXISTS public.admins CASCADE;
DROP TABLE IF EXISTS public.churches CASCADE;
DROP TABLE IF EXISTS public.church_groups CASCADE;

DROP POLICY IF EXISTS "Public read relay-uploads"         ON storage.objects;
DROP POLICY IF EXISTS "Allow upload relay-uploads"        ON storage.objects;
DROP POLICY IF EXISTS "Service role upload relay-uploads" ON storage.objects;

-- ============================================================
-- Church Groups
-- ============================================================
CREATE TABLE public.church_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  is_archived BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO church_groups (name) VALUES
  ('CCSGM'),
  ('His Dwelling Christian Church'),
  ('His Touch Ministries');

-- ============================================================
-- Churches
-- ============================================================
CREATE TABLE public.churches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  group_id    UUID NOT NULL REFERENCES church_groups(id),
  is_archived BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO churches (name, group_id)
SELECT v.name, g.id
FROM (VALUES
  ('CCSGM – Kawit',                               'CCSGM'),
  ('CCSGM – Imus',                                'CCSGM'),
  ('CCSGM – Cavite City',                         'CCSGM'),
  ('CCSGM – Dasma',                               'CCSGM'),
  ('CCSGM – Carrascal',                           'CCSGM'),
  ('CCSGM – Maitum',                              'CCSGM'),
  ('CCSGM – Madrid',                              'CCSGM'),
  ('CCSGM – Tandag',                              'CCSGM'),
  ('CCSGM – Castillo',                            'CCSGM'),
  ('CCSGM – Agusan Del Sur',                      'CCSGM'),
  ('CCSGM – Cabangahan',                          'CCSGM'),
  ('CCSGM – Nangka',                              'CCSGM'),
  ('CCSGM – Gacub',                               'CCSGM'),
  ('His Dwelling Christian Church – Cebu City',   'His Dwelling Christian Church'),
  ('His Dwelling Christian Church – Isabela',     'His Dwelling Christian Church'),
  ('His Touch Ministries',                        'His Touch Ministries')
) AS v(name, group_name)
JOIN church_groups g ON g.name = v.group_name;

-- ============================================================
-- Admins
-- ============================================================
CREATE TABLE public.admins (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  permissions           JSONB NOT NULL DEFAULT '{"receive_updates":true,"verify_payment":false,"merch_order_notify":false,"manage_admins":false,"manage_churches":false}',
  is_super_admin        BOOLEAN DEFAULT false,
  force_password_change BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Super admin seed — run `node seed-superadmin.js` to generate the hash
-- then paste the resulting INSERT statement here before running.

-- ============================================================
-- Registrations
-- ============================================================
CREATE TABLE public.registrations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ DEFAULT now(),

  -- Type: 'local' | 'international'
  registrant_type      TEXT NOT NULL DEFAULT 'local',

  -- Personal info
  name                 TEXT NOT NULL,
  age                  INTEGER NOT NULL,
  mobile               TEXT NOT NULL,
  email                TEXT NOT NULL,

  -- Local-only
  student_status       TEXT CHECK (student_status IN ('student', 'non-student')),
  school_id_url        TEXT,

  -- International-only
  country              TEXT,
  allergens            TEXT,

  -- Church (stored as display name, not FK — intentional)
  church               TEXT NOT NULL,

  -- Payment
  payment_ready        BOOLEAN DEFAULT false,
  payment_verified     BOOLEAN DEFAULT false,
  receipt_url          TEXT,

  -- Status
  status               TEXT DEFAULT 'awaiting_payment'
                       CHECK (status IN ('awaiting_payment','payment_pending_review','confirmed','cancelled','partially_paid')),

  -- Group registration
  group_id             UUID,
  group_size           INTEGER DEFAULT 1,

  -- Partial payments
  partial_paid_total   INTEGER DEFAULT 0,

  -- Audit
  verified_at          TIMESTAMPTZ,
  verified_by          TEXT,
  cancelled_at         TIMESTAMPTZ,
  cancelled_by         TEXT,
  cancellation_reason  TEXT,
  last_followup_at     TIMESTAMPTZ
);

-- Row Level Security
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert" ON public.registrations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select" ON public.registrations FOR SELECT USING (true);
CREATE POLICY "Allow update" ON public.registrations FOR UPDATE USING (true);

-- ============================================================
-- Partial Payments
-- ============================================================
CREATE TABLE public.partial_payments (
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
CREATE POLICY "Allow select partial_payments" ON public.partial_payments FOR SELECT USING (true);

-- ============================================================
-- Site Settings (single-row — id is always true, enforcing one row)
-- ============================================================
CREATE TABLE public.site_settings (
  id                          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  reg_ph_closed               BOOLEAN NOT NULL DEFAULT false,
  reg_intl_closed             BOOLEAN NOT NULL DEFAULT false,
  merch_preorder_closed       BOOLEAN NOT NULL DEFAULT false,
  merch_downpayment_percent   INTEGER NOT NULL DEFAULT 0,
  merch_sms_enabled           BOOLEAN NOT NULL DEFAULT false,
  merch_sms_template          TEXT,
  merch_order_email_notify    BOOLEAN NOT NULL DEFAULT true,
  updated_at                  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.site_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow select site_settings" ON public.site_settings FOR SELECT USING (true);

-- ============================================================
-- Merch Products
-- ============================================================
CREATE TABLE public.merch_products (
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
  stock          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX merch_products_active_sort_idx
  ON public.merch_products(is_active, sort_order, name);

ALTER TABLE public.merch_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read active merch_products"
  ON public.merch_products
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Service role manages merch_products"
  ON public.merch_products
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- Merch Preorders
-- ============================================================
CREATE TABLE public.merch_preorders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  email            TEXT NOT NULL,
  church           TEXT,
  items            JSONB NOT NULL,
  total_amount     INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','completed','cancelled')),
  deposit_amount   INTEGER DEFAULT 0,
  dp_percent       INTEGER,
  receipt_url      TEXT,
  receipt_path     TEXT,
  payment_status   TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid','partial','paid','cancelled')),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX merch_preorders_registration_id_idx
  ON public.merch_preorders(registration_id);

ALTER TABLE public.merch_preorders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages merch_preorders"
  ON public.merch_preorders
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

-- ============================================================
-- Storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('relay-uploads', 'relay-uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "Public read relay-uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'relay-uploads');

CREATE POLICY "Allow upload relay-uploads"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'relay-uploads');
