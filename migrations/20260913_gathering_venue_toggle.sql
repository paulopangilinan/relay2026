-- Round 32: config switch to turn "Pay at Venue" off for Gathering Around
-- the Gospel. Defaults OFF (opposite of the main site's ph_pay_later_enabled,
-- which defaults ON) per explicit user request. Toggled from the admin
-- Settings tab; checked server-side (fail-closed) in submit-gathering.js and
-- client-side in gathering.html to hide the option.
ALTER TABLE public.site_settings
  ADD COLUMN gathering_venue_payment_enabled BOOLEAN NOT NULL DEFAULT false;
