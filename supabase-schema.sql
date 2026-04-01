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
  permissions           JSONB NOT NULL DEFAULT '{"receive_updates":true,"verify_payment":false,"manage_admins":false,"manage_churches":false}',
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
                       CHECK (status IN ('awaiting_payment','payment_pending_review','confirmed','cancelled')),

  -- Group registration
  group_id             UUID,
  group_size           INTEGER DEFAULT 1,

  -- Audit
  verified_at          TIMESTAMPTZ,
  verified_by          TEXT,
  cancelled_at         TIMESTAMPTZ,
  cancelled_by         TEXT,
  cancellation_reason  TEXT
);

-- Row Level Security
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert" ON public.registrations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select" ON public.registrations FOR SELECT USING (true);
CREATE POLICY "Allow update" ON public.registrations FOR UPDATE USING (true);

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
