ALTER TABLE public.breakout_sessions
  ADD COLUMN IF NOT EXISTS speaker_registration_id UUID REFERENCES public.registrations(id);

CREATE UNIQUE INDEX IF NOT EXISTS breakout_sessions_speaker_registration_uidx
  ON public.breakout_sessions(speaker_registration_id)
  WHERE speaker_registration_id IS NOT NULL;
