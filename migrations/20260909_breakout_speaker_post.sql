-- Adds an editable "post" (position/title) field for each breakout session's
-- speaker — shown under their name on the breakout-selection page. Nullable:
-- falls back to a placeholder in the UI until an admin fills it in.
ALTER TABLE public.breakout_sessions
  ADD COLUMN IF NOT EXISTS speaker_post TEXT;
