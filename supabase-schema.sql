-- ============================================================
-- RELAY Conference 2026 — Supabase Schema
-- Full reset script — drops everything and starts fresh
-- ============================================================

-- Drop table
drop table if exists public.registrations cascade;

-- Drop storage policies (ignore errors if they don't exist)
drop policy if exists "Public read relay-uploads"     on storage.objects;
drop policy if exists "Allow upload relay-uploads"    on storage.objects;
drop policy if exists "Service role upload relay-uploads" on storage.objects;

-- ============================================================
-- Registrations table
-- ============================================================
create table public.registrations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  verified_at      timestamptz,

  -- Type: 'local' | 'international'
  registrant_type  text not null default 'local',

  -- Personal info (both forms)
  name             text not null,
  age              integer not null,
  mobile           text not null,
  email            text not null,

  -- Local-only
  student_status   text check (student_status in ('student', 'non-student')),
  school_id_url    text,

  -- International-only
  country          text,
  allergens        text,

  -- Church (dropdown value for local, plain text for international)
  church           text not null,

  -- Payment
  payment_ready    boolean default false,
  payment_verified boolean default false,
  receipt_url      text,

  -- Status: awaiting_payment | payment_pending_review | confirmed
  status           text default 'awaiting_payment'
);

-- Row Level Security
alter table public.registrations enable row level security;

create policy "Allow insert" on public.registrations for insert with check (true);
create policy "Allow select" on public.registrations for select using (true);
create policy "Allow update" on public.registrations for update using (true);

-- ============================================================
-- Storage bucket
-- ============================================================
insert into storage.buckets (id, name, public)
values ('relay-uploads', 'relay-uploads', true)
on conflict (id) do update set public = true;

create policy "Public read relay-uploads"
  on storage.objects for select
  using (bucket_id = 'relay-uploads');

create policy "Allow upload relay-uploads"
  on storage.objects for insert
  with check (bucket_id = 'relay-uploads');

-- ── Admin Users ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  permissions           JSONB NOT NULL DEFAULT '{"receive_updates":true,"verify_payment":false,"manage_admins":false}',
  is_super_admin        BOOLEAN DEFAULT false,
  force_password_change BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ── Super Admin seed (run separately after installing bcrypt) ─────────────────
-- Use the Node script below to generate the hash, then paste it here.
-- INSERT INTO admins (email, name, password_hash, permissions, is_super_admin, force_password_change)
-- VALUES (
--   'paulopangilinan@gmail.com',
--   'Paulo Pangilinan',
--   '<PASTE_HASH_HERE>',
--   '{"receive_updates":true,"verify_payment":true,"manage_admins":true}',
--   true,
--   true
-- );

-- ── Group Registration Columns ─────────────────────────────────────────────
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS group_size INTEGER DEFAULT 1;

-- ── Add cancelled status support ──────────────────────────────────────────────
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_status_check;
ALTER TABLE registrations ADD CONSTRAINT registrations_status_check
  CHECK (status IN ('awaiting_payment', 'payment_pending_review', 'confirmed', 'cancelled'));

-- ── Audit columns ─────────────────────────────────────────────────────────────
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS verified_by       TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS cancelled_by      TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- ── Churches table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS churches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  group_name  TEXT NOT NULL,
  is_archived BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed data
INSERT INTO churches (name, group_name) VALUES
  ('CCSGM – Kawit',          'CCSGM'),
  ('CCSGM – Imus',           'CCSGM'),
  ('CCSGM – Cavite City',    'CCSGM'),
  ('CCSGM – Dasma',          'CCSGM'),
  ('CCSGM – Carrascal',      'CCSGM'),
  ('CCSGM – Maitum',         'CCSGM'),
  ('CCSGM – Madrid',         'CCSGM'),
  ('CCSGM – Tandag',         'CCSGM'),
  ('CCSGM – Castillo',       'CCSGM'),
  ('CCSGM – Agusan Del Sur', 'CCSGM'),
  ('CCSGM – Cabangahan',     'CCSGM'),
  ('CCSGM – Nangka',         'CCSGM'),
  ('CCSGM – Gacub',          'CCSGM'),
  ('His Dwelling Christian Church – Cebu City', 'His Dwelling Christian Church'),
  ('His Dwelling Christian Church – Isabela',   'His Dwelling Christian Church'),
  ('His Touch Ministries',   'His Touch Ministries')
ON CONFLICT DO NOTHING;

-- ── Add manage_churches to existing super admins ──────────────────────────────
UPDATE admins
SET permissions = permissions || '{"manage_churches": true}'::jsonb
WHERE is_super_admin = true;
