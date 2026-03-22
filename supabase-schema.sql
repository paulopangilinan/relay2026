-- ============================================================
-- RELAY Conference 2026 — Supabase Schema
-- Run this in Supabase → SQL Editor → New Query → Run
-- ============================================================

-- Registrations table
create table if not exists public.registrations (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  verified_at     timestamptz,

  -- Personal info
  name            text not null,
  age             integer not null,
  mobile          text not null,
  email           text not null,

  -- Conference details
  student_status  text not null check (student_status in ('student', 'non-student')),
  church          text not null,

  -- Payment
  payment_ready   boolean default false,
  payment_verified boolean default false,
  school_id_url   text,
  receipt_url     text,

  -- Status: awaiting_payment | payment_pending_review | confirmed
  status          text default 'awaiting_payment'
);

-- Enable Row Level Security
alter table public.registrations enable row level security;

-- Policy: allow insert from anyone (the function uses service role, but this keeps it open for the anon key too)
create policy "Allow insert"
  on public.registrations
  for insert
  with check (true);

-- Policy: allow select/update only via service role
create policy "Allow select"
  on public.registrations
  for select
  using (true);

create policy "Allow update"
  on public.registrations
  for update
  using (true);

-- ============================================================
-- Storage bucket for uploads
-- ============================================================

insert into storage.buckets (id, name, public)
values ('relay-uploads', 'relay-uploads', true)
on conflict do nothing;

create policy "Public read relay-uploads"
  on storage.objects for select
  using (bucket_id = 'relay-uploads');

create policy "Allow upload relay-uploads"
  on storage.objects for insert
  with check (bucket_id = 'relay-uploads');
