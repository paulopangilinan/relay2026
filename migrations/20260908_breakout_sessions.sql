-- Breakout session selection (Sept 25, 11am–12nn). Participants pick one of
-- four concurrent sessions; each is capped at 45 seats, first-come-first-served.

CREATE TABLE IF NOT EXISTS public.breakout_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  speaker      TEXT NOT NULL,
  capacity     INTEGER NOT NULL DEFAULT 45,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS breakout_sessions_active_sort_idx
  ON public.breakout_sessions(is_active, sort_order);

ALTER TABLE public.breakout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active breakout_sessions" ON public.breakout_sessions;
CREATE POLICY "Public read active breakout_sessions"
  ON public.breakout_sessions
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Service role manages breakout_sessions" ON public.breakout_sessions;
CREATE POLICY "Service role manages breakout_sessions"
  ON public.breakout_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.breakout_sessions (title, speaker, capacity, sort_order) VALUES
  ('Thinking About Love: A Biblical View On Relationships',                'Jeffrey Jo',       45, 10),
  ('Finding The Will Of God: Seeing With Clarity In A Sea Of Decisions',   'Dave Taylor',      45, 20),
  ('A Heart Aflame For God: Devoted To A Deeper Life',                    'Riley Spring',     45, 30),
  ('An Eye For Grace: The Edifying Ministry Of Encouragement',            'Jared Mellinger',  45, 40)
ON CONFLICT DO NOTHING;

-- One selection per registration. Re-selecting (before the due date, while
-- the newly chosen session still has room) updates this row rather than
-- inserting a second one — enforced at the application layer, backstopped
-- here by the unique constraint.
CREATE TABLE IF NOT EXISTS public.breakout_selections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  session_id       UUID NOT NULL REFERENCES public.breakout_sessions(id) ON DELETE RESTRICT,
  participant_name TEXT,
  email            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (registration_id)
);

CREATE INDEX IF NOT EXISTS breakout_selections_session_idx
  ON public.breakout_selections(session_id);

ALTER TABLE public.breakout_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages breakout_selections" ON public.breakout_selections;
CREATE POLICY "Service role manages breakout_selections"
  ON public.breakout_selections
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
