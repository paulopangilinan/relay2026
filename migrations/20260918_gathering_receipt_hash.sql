-- Byte-identical receipt reuse detection. receipt_hash is a SHA-256 hex
-- digest of the uploaded GCash receipt's bytes, computed in
-- submit-gathering.js. On a match against any other non-cancelled row,
-- BOTH rows get flagged_duplicate = true — the new submission and the
-- original it matched — so admin sees both sides, not just whichever one
-- happened to submit second. Never blocks the submission itself; this is
-- a review flag, not a rejection.

ALTER TABLE public.gathering_registrations
  ADD COLUMN IF NOT EXISTS receipt_hash text,
  ADD COLUMN IF NOT EXISTS flagged_duplicate boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_gathering_registrations_receipt_hash
  ON public.gathering_registrations (receipt_hash)
  WHERE receipt_hash IS NOT NULL;
