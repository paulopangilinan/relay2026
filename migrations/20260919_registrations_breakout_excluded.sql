-- Round 72: lets an admin permanently mark a registration (typically a
-- speaker registered through the normal flow) as excluded from breakout
-- session assignment entirely — excluded from blast emails (New Invite,
-- Reminder, Send Selected) and blocked from being assigned a session, by
-- an admin or via the participant's own self-selection link.
--
-- A registration can only be toggled excluded while it holds NO breakout
-- session (see the 409 guard in admin-breakout-responses.js) — the two
-- states (assigned vs. excluded) never overlap.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS breakout_excluded boolean NOT NULL DEFAULT false;
