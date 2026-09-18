-- Round 106: manual participants (Round 103) can now land directly in
-- Unassigned instead of always going straight onto a session — the "+ Add"
-- button moved to the Unassigned column, and a manual participant can also
-- be dragged/moved back to Unassigned later without being deleted.
-- session_id was still NOT NULL from the original schema (only
-- registration_id was relaxed in Round 103's migration), which is exactly
-- what throws "null value in column session_id ... violates not-null
-- constraint" when the app tries to insert/update one with no session.
ALTER TABLE public.breakout_selections
  ALTER COLUMN session_id DROP NOT NULL;
