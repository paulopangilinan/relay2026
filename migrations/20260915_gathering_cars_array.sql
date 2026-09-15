-- Replaces the single car_maker/car_model/car_plate text fields with a
-- proper per-registrant array of vehicles — the old shape only ever
-- allowed one car, which is why one large-group registrant worked around
-- it by cramming 6 vehicles' worth of data into the 3 single fields as
-- comma-separated, index-aligned lists.
--
-- The old columns are NOT dropped. Current single-car data is still
-- valid and is honored via the backfill below (every existing bringing_car
-- row is copied into the new array as its one vehicle) — dropping them
-- afterward would be pure cleanup with no data-safety benefit, so they're
-- left in place unused going forward, same convention as previous rounds
-- (e.g. the `speaker` text column kept alongside `speaker_registration_id`).
ALTER TABLE public.gathering_registrations
  ADD COLUMN IF NOT EXISTS cars JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: every existing single-car registrant's data is preserved
-- as-is, as the one vehicle in their new array. Runs for every such row,
-- including the one corrected individually below — the specific
-- correction below runs second and overwrites this row's garbled
-- single-vehicle backfill with the properly parsed 6-vehicle array.
UPDATE public.gathering_registrations
SET cars = jsonb_build_array(jsonb_build_object('maker', car_maker, 'model', car_model, 'plate', car_plate))
WHERE bringing_car = true AND car_maker IS NOT NULL AND car_maker != '';

-- One-off correction: this registrant (18 participants, large group)
-- entered 6 vehicles' worth of comma-separated, index-aligned data into
-- the single car_maker/car_model/car_plate fields, since the form had no
-- way to enter more than one car at the time. Confirmed index-alignment
-- and the correct per-vehicle breakdown with the user directly.
UPDATE public.gathering_registrations
SET cars = '[
  {"maker":"Toyota","model":"Grandia (White)","plate":"DCI 3832"},
  {"maker":"Chevrolet","model":"Trailblazer (White)","plate":"NCN 6521"},
  {"maker":"Ford","model":"Everest (Black)","plate":"NBZ 6185"},
  {"maker":"Toyota","model":"Raize (White)","plate":"DBG 8365"},
  {"maker":"Suzuki","model":"Jimny (Cream)","plate":"DCE 4676"},
  {"maker":"Ford","model":"Ranger (Orange)","plate":"NGJ 6704"}
]'::jsonb
WHERE id = '46e18386-002d-48eb-b3e4-9a3ed4770f56';
