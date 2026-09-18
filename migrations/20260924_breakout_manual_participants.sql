-- Round 103: lets an admin add a participant to a breakout session who has
-- no record in `registrations` at all (a walk-in, a guest speaker's
-- companion, someone registered on paper). They're added straight onto a
-- session — there's no "Unassigned" home for them the way a real
-- registrant gets, since that pool is built entirely FROM `registrations`
-- (see admin-breakout-responses.js's GET handler); with no registrations
-- row, there's nothing to diff against. Removing one later deletes the row
-- outright rather than sending them back to a pool that doesn't exist for
-- them.

ALTER TABLE public.breakout_selections
  ALTER COLUMN registration_id DROP NOT NULL;

-- A manual row (registration_id IS NULL) has no registrations row to pull a
-- name from, so it must carry its own. participant_name already existed as
-- a nullable denormalized copy of the registrant's name for the
-- registration-backed rows the app has always populated it for — this just
-- makes it load-bearing (required) for manual ones specifically.
ALTER TABLE public.breakout_selections
  ADD CONSTRAINT breakout_selections_identity_chk
  CHECK (registration_id IS NOT NULL OR participant_name IS NOT NULL);

-- No change needed to the existing UNIQUE (registration_id) constraint —
-- Postgres already treats every NULL as distinct from every other NULL in
-- a unique column, so any number of manual (NULL) rows can coexist without
-- colliding.
