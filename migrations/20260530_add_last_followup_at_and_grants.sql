-- Migration: 2026-05-30
-- 1. Add last_followup_at column to registrations
-- 2. Add explicit Data API grants ahead of Supabase enforcement (2026-10-30)

-- ── Column addition ───────────────────────────────────────────────────────────
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ;

-- ── Data API grants ───────────────────────────────────────────────────────────
-- Required for PostgREST / supabase-js access after Supabase's policy change.
-- Service role key bypasses these, but grants must exist for anon/authenticated.

-- Registration form reads church groups and churches
GRANT SELECT ON public.church_groups TO anon, authenticated;
GRANT SELECT ON public.churches      TO anon, authenticated;

-- Registrations: mirrors existing RLS policies (insert, select, update)
GRANT SELECT, INSERT, UPDATE ON public.registrations TO anon, authenticated;

-- admins: intentionally NOT granted — only accessed via service role key
