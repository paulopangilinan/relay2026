-- Round 21: adjustable participant cap for Gathering Around the Gospel.
-- Stored in site_settings (not an env var) so admins can raise it live —
-- e.g. 500 -> 600 -- to reopen registration without a redeploy.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS gathering_max_participants INTEGER NOT NULL DEFAULT 500;
