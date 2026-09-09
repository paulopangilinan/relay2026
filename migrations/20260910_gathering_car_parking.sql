-- Round 2 addition: parking info for Gathering Around the Gospel.
-- One vehicle per registration (not per participant) — participant_count
-- is just a headcount, not individually named entries.

ALTER TABLE public.gathering_registrations
  ADD COLUMN bringing_car BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN car_maker    TEXT,
  ADD COLUMN car_model    TEXT,
  ADD COLUMN car_plate    TEXT;
