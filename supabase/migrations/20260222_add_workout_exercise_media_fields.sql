alter table public.workout_exercises_def
add column if not exists source_id text,
add column if not exists video_path text,
add column if not exists thumbnail_path text;