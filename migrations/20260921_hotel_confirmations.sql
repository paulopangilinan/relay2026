-- Round 97: printable hotel/RELAY confirmation emails for international
-- registrants. One row per SEND ATTEMPT (not per registrant) so a corrected
-- resend keeps history instead of overwriting, and so a failed send still
-- leaves an audit trail — same "record the outcome, don't fire and forget"
-- convention the Gathering email statuses use.
--
-- No pdf_url column: the PDF attachment was parked (Round 97 decision), so
-- the email itself is the deliverable and is styled to print cleanly.

-- Sequence backs confirmation_no so two concurrent sends can't collide the
-- way a SELECT count(*) + 1 scheme would.
CREATE SEQUENCE IF NOT EXISTS public.hotel_confirmation_seq START 1;

-- PostgREST can only call functions in the exposed (public) schema, so
-- nextval() in pg_catalog isn't reachable over supabase.rpc() directly —
-- hence this thin wrapper, which also formats the number so the padding
-- convention lives in one place instead of in the function code.
CREATE OR REPLACE FUNCTION public.next_hotel_confirmation_no()
RETURNS TEXT
LANGUAGE SQL
VOLATILE
AS $$
  SELECT 'RLY-HTL-' || LPAD(nextval('public.hotel_confirmation_seq')::TEXT, 6, '0');
$$;

CREATE TABLE IF NOT EXISTS public.hotel_confirmations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id   UUID NOT NULL REFERENCES public.registrations(id),
  -- Venue + dates are fixed, published constants (see HOTEL in
  -- netlify/lib/hotel-confirmation-email.js). Snapshotted per row anyway so
  -- an old confirmation always reproduces exactly what was sent, even if the
  -- constants are edited later.
  hotel_name        TEXT NOT NULL,
  hotel_address     TEXT,
  room_type         TEXT NOT NULL,
  max_occupancy     INTEGER NOT NULL,
  check_in_date     DATE NOT NULL,
  check_out_date    DATE NOT NULL,
  check_in_time     TEXT NOT NULL DEFAULT '2:00 PM',
  check_out_time    TEXT NOT NULL DEFAULT '11:00 AM',
  num_nights        INTEGER NOT NULL,
  confirmation_no   TEXT NOT NULL UNIQUE,
  roommates         TEXT,
  notes             TEXT,
  -- 'sent' | 'failed' — the row is inserted BEFORE the send is attempted, so
  -- a crash mid-send still leaves evidence rather than nothing at all.
  email_status      TEXT NOT NULL DEFAULT 'sent',
  email_provider    TEXT,
  sent_at           TIMESTAMPTZ DEFAULT now(),
  sent_by           TEXT
);

-- Only query path is "confirmations for this registrant", newest first.
CREATE INDEX IF NOT EXISTS hotel_confirmations_registration_idx
  ON public.hotel_confirmations (registration_id, sent_at DESC);
