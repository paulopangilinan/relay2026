-- Ties each breakout session's speaker to a real registrant record instead
-- of a free-text name only — every current/future breakout speaker already
-- has a registration on file, so this is a real 1:1 link, not a fallback
-- convenience. Nullable at the DB level purely because this migration has
-- no way to know which registrations.id corresponds to each of the 4
-- already-seeded sessions' speakers (Jeffrey Jo, Dave Taylor, Riley Spring,
-- Jared Mellinger) — an admin links each one manually via the new picker in
-- the session editor after this ships. The partial unique index still
-- enforces the real 1:1 rule (one registrant can't be linked to two
-- sessions) from the moment each session gets linked; app-level validation
-- in admin-breakout-sessions.js requires it for any new/edited session even
-- though the column itself stays nullable here.
--
-- The old free-text `speaker` / `speaker_post` columns are NOT dropped or
-- changed — `speaker_post` (position/title) has no registrant equivalent
-- and stays free text regardless; `speaker` is kept in sync with the linked
-- registrant's name by the application (see admin-breakout-sessions.js),
-- so every existing consumer of that column (the participant board, the
-- Assign modal, the public breakout-selection page, the Excel export)
-- keeps working unmodified.
ALTER TABLE public.breakout_sessions
  ADD COLUMN IF NOT EXISTS speaker_registration_id UUID REFERENCES public.registrations(id);

CREATE UNIQUE INDEX IF NOT EXISTS breakout_sessions_speaker_registration_uidx
  ON public.breakout_sessions(speaker_registration_id)
  WHERE speaker_registration_id IS NOT NULL;
