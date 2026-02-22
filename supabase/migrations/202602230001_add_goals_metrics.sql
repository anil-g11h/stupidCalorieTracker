
ALTER TABLE public.goals
ADD COLUMN IF NOT EXISTS sleep_target numeric DEFAULT 8,
ADD COLUMN IF NOT EXISTS water_target numeric DEFAULT 2000,
ADD COLUMN IF NOT EXISTS weight_target numeric DEFAULT 0;
