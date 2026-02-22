ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS diet_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allergen_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_notes text;
