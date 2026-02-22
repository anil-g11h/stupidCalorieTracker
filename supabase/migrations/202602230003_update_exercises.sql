-- Add secondary_muscle_groups and ensure metric types
alter table public.workout_exercises_def 
add column if not exists secondary_muscle_groups text[] default '{}',
add column if not exists metric_type text default 'weight_reps'; 
-- metric_type values: 'weight_reps', 'reps_only', 'weighted_bodyweight', 'duration', 'duration_weight', 'distance_duration', 'distance_weight'

-- Update RLS if needed (existing policies should cover cols)
