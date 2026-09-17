-- Round 98: feedback on the Round 97 accommodation confirmation.
--   * admins can supply the hotel's OWN confirmation id when they have one
--   * the banner image and the organisation subtitle are per-send toggles
--   * a booking date, defaulting to the registrant's registration date
--   * generated numbers move to the SGC-RLY- prefix
--
-- Additive only — every column is nullable or defaulted, so rows written by
-- the Round 97 code still read back fine.

ALTER TABLE public.hotel_confirmations
  -- The hotel's own reference, when the admin has one. Deliberately NOT
  -- folded into confirmation_no: that column is UNIQUE and is our internal
  -- audit key, and a legitimate corrected resend of the same booking would
  -- carry the same hotel reference and collide. So we always generate and
  -- store our own, and this is what the registrant is shown instead when
  -- it's present. No UNIQUE here for the same reason.
  ADD COLUMN IF NOT EXISTS external_confirmation_no TEXT,
  -- Per-send presentation choices, snapshotted like everything else on this
  -- row so a reprint reproduces exactly what was emailed.
  ADD COLUMN IF NOT EXISTS show_banner   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_subtitle BOOLEAN NOT NULL DEFAULT false,
  -- When the booking was made. Defaults (in the modal) to the registrant's
  -- registration date, but it's a free date picker — a room can be booked
  -- long after someone registers. Nullable: rows written before this
  -- migration genuinely have no booking date, and inventing one would be
  -- worse than showing nothing.
  ADD COLUMN IF NOT EXISTS booking_date  DATE;

-- New prefix per Round 98 feedback. Same sequence, so numbers already issued
-- under the RLY-HTL- prefix are never reused — the sequence just continues.
--
-- The stem is fixed and the sequence is appended, zero-padded to 2 so early
-- numbers read as SGC-RLY-25001201, 25001202, ... Once the sequence passes
-- 99 the number simply gets longer rather than wrapping or truncating;
-- LPAD only pads, it never trims.
CREATE OR REPLACE FUNCTION public.next_hotel_confirmation_no()
RETURNS TEXT
LANGUAGE SQL
VOLATILE
AS $$
  SELECT 'SGC-RLY-250012' || LPAD(nextval('public.hotel_confirmation_seq')::TEXT, 2, '0');
$$;
