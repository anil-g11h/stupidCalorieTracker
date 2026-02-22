ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_settings (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  nutrition jsonb NOT NULL DEFAULT '{}'::jsonb,
  meals jsonb NOT NULL DEFAULT '[]'::jsonb,
  reminders jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to read own settings" ON public.user_settings;
CREATE POLICY "Allow users to read own settings" ON public.user_settings
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to insert own settings" ON public.user_settings;
CREATE POLICY "Allow users to insert own settings" ON public.user_settings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND auth.uid() = id);

DROP POLICY IF EXISTS "Allow users to update own settings" ON public.user_settings;
CREATE POLICY "Allow users to update own settings" ON public.user_settings
  FOR UPDATE
  USING (auth.uid() = user_id AND auth.uid() = id);
