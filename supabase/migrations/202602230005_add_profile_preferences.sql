ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS diet_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allergies text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS custom_allergies text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS goal_focus text,
  ADD COLUMN IF NOT EXISTS activity_level text,
  ADD COLUMN IF NOT EXISTS medical_constraints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS meal_pattern text;

DROP POLICY IF EXISTS "Allow users to insert own profile" ON public.profiles;
CREATE POLICY "Allow users to insert own profile" ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);
