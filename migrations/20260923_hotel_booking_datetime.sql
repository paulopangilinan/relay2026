-- Round 98 follow-up: the modal's Booking Date field grew a time component
-- (it's a <input type="datetime-local"> now, defaulting to the registrant's
-- registration date AND time), so the column needs to carry a time too.
--
-- booking_date was added as a bare DATE in 20260922_hotel_confirmation_options.sql.
-- Anything already written under that migration still reads fine — a DATE
-- casts losslessly up to a TIMESTAMPTZ at local midnight; nothing is dropped
-- by widening the type, only by narrowing it.
ALTER TABLE public.hotel_confirmations
  ALTER COLUMN booking_date TYPE TIMESTAMPTZ USING booking_date::timestamptz;
