-- Round 108: capture church for manually-added breakout participants
-- ("+ Add" on the Unassigned column, Round 103/106) — previously these
-- rows always showed as "No registration on file" wherever a real
-- registrant's church would appear (card meta line, Excel export), since
-- there was nowhere to store one. Required going forward (validated in
-- admin-breakout-responses.js's POST handler), same as name already is,
-- but nullable here so existing manual rows created before this migration
-- don't need a backfill to remain valid.
ALTER TABLE public.breakout_selections
  ADD COLUMN IF NOT EXISTS participant_church TEXT;
