-- Round 104: capture age for manually-added breakout participants (Round
-- 103's "+ Add" flow only asked for name/email). Nullable — optional, same
-- as email already is for these rows.
ALTER TABLE public.breakout_selections
  ADD COLUMN IF NOT EXISTS participant_age INTEGER;
