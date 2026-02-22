-- Workouts
create table if not exists public.workout_exercises_def ( -- Renamed to better clarify. This is the exercise library
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id), -- Null means global/public exercise
  name text not null,
  muscle_group text, -- 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Other'
  equipment text, -- 'Barbell', 'Dumbbell', 'Machine', 'Bodyweight', 'Cable', 'Other'
  primary_metric text default 'reps_weight', -- 'reps_weight', 'time_weight', 'time_distance', 'time'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Workout Logs (The actual session)
create table if not exists public.workouts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  name text, -- e.g. "Morning Lift"
  start_time timestamp with time zone default timezone('utc'::text, now()) not null,
  end_time timestamp with time zone,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Workout Log Entries (Exercises performed in a workout)
create table if not exists public.workout_log_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  workout_id uuid references public.workouts(id) on delete cascade not null,
  exercise_id uuid references public.workout_exercises_def(id) not null,
  sort_order integer not null default 0,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Workout Sets
create table if not exists public.workout_sets (
  id uuid default gen_random_uuid() primary key,
  workout_log_entry_id uuid references public.workout_log_entries(id) on delete cascade not null,
  set_number integer not null default 1,
  weight numeric,
  reps numeric,
  distance numeric, -- in meters or km? let's stick to standard unit (e.g. km or meters)
  duration_seconds integer,
  rpe numeric, -- Rate of Perceived Exertion (1-10)
  is_warmup boolean default false,
  completed boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies
alter table public.workout_exercises_def enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_log_entries enable row level security;
alter table public.workout_sets enable row level security;

-- Exercises: Public readout + User private
drop policy if exists "Allow public exercises read access" on public.workout_exercises_def;
create policy "Allow public exercises read access" on public.workout_exercises_def for select using (user_id is null or auth.uid() = user_id);
drop policy if exists "Allow users to manage own exercises" on public.workout_exercises_def;
create policy "Allow users to manage own exercises" on public.workout_exercises_def for all using (auth.uid() = user_id);

-- Workouts: User private
drop policy if exists "Allow users to manage own workouts" on public.workouts;
create policy "Allow users to manage own workouts" on public.workouts for all using (auth.uid() = user_id);

-- Entries: User private (via workout ownership, but safer to be specific or join)
drop policy if exists "Allow users to manage own entries" on public.workout_log_entries;
create policy "Allow users to manage own entries" on public.workout_log_entries for all using (auth.uid() = user_id);

-- Sets: User private
drop policy if exists "Allow users to manage own sets" on public.workout_sets;
create policy "Allow users to manage own sets" on public.workout_sets for all using (
    exists (
        select 1 from public.workout_log_entries wle
        where wle.id = workout_log_entry_id and wle.user_id = auth.uid()
    )
);
