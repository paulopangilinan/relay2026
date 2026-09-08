-- Tracks whether a registrant has ever received a breakout-session invite
-- email. Lets the admin "Breakout Email" button auto-decide, per person,
-- whether this is their first invite or a reminder — instead of requiring
-- a human to pick "New Invite" vs "Session Pick Reminder" by hand, which
-- was one accidental click away from re-sending the initial invite to
-- someone who'd already gotten it.

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS breakout_invited_at TIMESTAMPTZ;
