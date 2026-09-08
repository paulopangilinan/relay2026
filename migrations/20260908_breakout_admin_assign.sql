-- Adds admin-assignment tracking to breakout selections.
-- selected_by_admin: true  = admin assigned this participant (can be reassigned)
--                   false / NULL = participant chose their own session (locked, never reassignable)
-- assigned_at: timestamp of admin assignment (null for self-selected)

ALTER TABLE public.breakout_selections
  ADD COLUMN IF NOT EXISTS selected_by_admin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_at       TIMESTAMPTZ;
