-- Round 110: food-pack distribution (/distro admin scanner + /distro-ctr
-- public venue counter). Adds a per-registration claim code pair and the
-- claim-state columns distro-lookup.js / distro-claim.js read and write.

ALTER TABLE public.gathering_registrations
  ADD COLUMN food_qr_code         TEXT,             -- opaque token, printed/emailed as a QR
  ADD COLUMN food_passcode        TEXT,              -- 6-char human-typeable fallback
  ADD COLUMN food_claimed         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN food_claimed_at      TIMESTAMPTZ,
  ADD COLUMN food_claimed_by      TEXT,              -- admin email, from distro-claim.js
  ADD COLUMN food_claimed_method  TEXT CHECK (food_claimed_method IN ('qr', 'passcode', 'admin_override'));

-- Both codes are looked up by exact/case-insensitive match on every scan
-- (distro-lookup.js), so they need to be unique and indexed. Existing rows
-- get backfilled below; new rows get theirs from submit-gathering.js at
-- insert time.
CREATE UNIQUE INDEX gathering_registrations_food_qr_code_idx
  ON public.gathering_registrations (food_qr_code) WHERE food_qr_code IS NOT NULL;
CREATE UNIQUE INDEX gathering_registrations_food_passcode_idx
  ON public.gathering_registrations (food_passcode) WHERE food_passcode IS NOT NULL;

-- Backfill: every pre-existing row needs a code pair too, or it's
-- permanently unscannable (name-search + admin_override only). Passcode
-- excludes visually-ambiguous characters (0/O, 1/I) since it's hand-typed
-- at a table; QR token is just a wider random hex id since it's never
-- typed, only scanned.
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  FOR r IN SELECT id FROM public.gathering_registrations WHERE food_passcode IS NULL LOOP
    LOOP
      new_code := '';
      FOR i IN 1..6 LOOP
        new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.gathering_registrations WHERE food_passcode = new_code);
    END LOOP;
    UPDATE public.gathering_registrations
      SET food_passcode = new_code, food_qr_code = encode(gen_random_bytes(16), 'hex')
      WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.gathering_registrations
  ALTER COLUMN food_qr_code SET NOT NULL,
  ALTER COLUMN food_passcode SET NOT NULL;
