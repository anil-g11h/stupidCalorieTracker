-- Upsert Indoor Cycle global exercise and attach custom thumbnail image
ALTER TABLE public.workout_exercises_def
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS video_path text,
  ADD COLUMN IF NOT EXISTS thumbnail_path text,
  ADD COLUMN IF NOT EXISTS metric_type text DEFAULT 'weight_reps';

UPDATE public.workout_exercises_def
SET
  thumbnail_path = 'workouts/images/indoor-cycle-thumb.png',
  muscle_group = 'Cardio',
  equipment = 'Machine',
  metric_type = 'distance_duration',
  updated_at = timezone('utc'::text, now())
WHERE user_id IS NULL
  AND lower(btrim(name)) IN ('indoor cycle', 'indoor cycling');

INSERT INTO public.workout_exercises_def (
  id,
  user_id,
  source_id,
  name,
  muscle_group,
  equipment,
  video_path,
  thumbnail_path,
  metric_type,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  NULL,
  NULL,
  'Indoor Cycle',
  'Cardio',
  'Machine',
  NULL,
  'workouts/images/indoor-cycle-thumb.png',
  'distance_duration',
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
)
ON CONFLICT ((lower(btrim(name)))) WHERE (user_id IS NULL)
DO UPDATE SET
  muscle_group = EXCLUDED.muscle_group,
  equipment = EXCLUDED.equipment,
  thumbnail_path = EXCLUDED.thumbnail_path,
  metric_type = EXCLUDED.metric_type,
  updated_at = timezone('utc'::text, now());
