-- Profiles
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  username text unique,
  full_name text,
  avatar_url text,
  diet_tags text[] not null default '{}',
  allergies text[] not null default '{}',
  custom_allergies text[] not null default '{}',
  goal_focus text,
  activity_level text,
  medical_constraints text[] not null default '{}',
  meal_pattern text,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Foods (Recursive Structure)
create table if not exists public.foods (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id), -- Null means global/public food
  name text not null,
  brand text,
  diet_tags text[] not null default '{}',
  allergen_tags text[] not null default '{}',
  ai_notes text,
  calories numeric not null default 0, -- per serving
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  serving_size numeric default 100,
  serving_unit text default 'g',
  is_recipe boolean default false,
  is_public boolean default false,
  micros jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Food Ingredients (Join table for recipes)
create table if not exists public.food_ingredients (
  id uuid default gen_random_uuid() primary key,
  parent_food_id uuid references public.foods(id) on delete cascade not null, -- The Recipe
  child_food_id uuid references public.foods(id) on delete cascade not null, -- The Ingredient
  quantity numeric not null, -- Amount of child food used in parent recipe
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Daily Logs
create table if not exists public.daily_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  date date not null default current_date,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'supplement')),
  food_id uuid references public.foods(id),
  amount_consumed numeric not null default 1, -- Multiplier of serving size
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Goals (Versioned)
create table if not exists public.goals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  start_date date not null default current_date,
  calories_target numeric not null,
  protein_target numeric not null,
  carbs_target numeric not null,
  fat_target numeric not null,
  sleep_target numeric default 8,
  water_target numeric default 2000,
  weight_target numeric default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Body Metrics (Flexible)
create table if not exists public.body_metrics (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  date date not null default current_date,
  type text not null, -- 'weight', 'waist', 'chest', 'bicep_left', etc.
  value numeric not null,
  unit text not null, -- 'kg', 'lbs', 'cm', 'in'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- User Settings (nutrition, meals, reminders)
create table if not exists public.user_settings (
  id uuid references auth.users(id) on delete cascade not null primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  nutrition jsonb not null default '{}'::jsonb,
  meals jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies
alter table public.profiles enable row level security;
alter table public.foods enable row level security;
alter table public.food_ingredients enable row level security;
alter table public.daily_logs enable row level security;
alter table public.goals enable row level security;
alter table public.body_metrics enable row level security;
alter table public.user_settings enable row level security;

-- Profiles: Users can read/update their own profile
drop policy if exists "Allow users to read own profile" on public.profiles;
create policy "Allow users to read own profile" on public.profiles for select using (auth.uid() = id);

drop policy if exists "Allow users to update own profile" on public.profiles;
create policy "Allow users to update own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "Allow users to insert own profile" on public.profiles;
create policy "Allow users to insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Foods: Users can read public foods or their own foods
drop policy if exists "Allow public foods read access" on public.foods;
create policy "Allow public foods read access" on public.foods for select using (is_public = true or auth.uid() = user_id);

drop policy if exists "Allow users to manage own foods" on public.foods;
create policy "Allow users to manage own foods" on public.foods for all using (auth.uid() = user_id);

-- Rest: Private to user
drop policy if exists "Allow users to manage own ingredients" on public.food_ingredients;
create policy "Allow users to manage own ingredients" on public.food_ingredients for all using (
    exists (select 1 from public.foods where id = parent_food_id and user_id = auth.uid())
);

drop policy if exists "Allow users to manage own logs" on public.daily_logs;
create policy "Allow users to manage own logs" on public.daily_logs for all using (auth.uid() = user_id);

drop policy if exists "Allow users to manage own goals" on public.goals;
create policy "Allow users to manage own goals" on public.goals for all using (auth.uid() = user_id);

drop policy if exists "Allow users to manage own metrics" on public.body_metrics;
create policy "Allow users to manage own metrics" on public.body_metrics for all using (auth.uid() = user_id);

drop policy if exists "Allow users to read own settings" on public.user_settings;
create policy "Allow users to read own settings" on public.user_settings for select using (auth.uid() = user_id);

drop policy if exists "Allow users to insert own settings" on public.user_settings;
create policy "Allow users to insert own settings" on public.user_settings for insert with check (auth.uid() = user_id and auth.uid() = id);

drop policy if exists "Allow users to update own settings" on public.user_settings;
create policy "Allow users to update own settings" on public.user_settings for update using (auth.uid() = user_id and auth.uid() = id);

-- Activities
create table if not exists public.activities (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id), -- Null means global/public activity
  name text not null,
  calories_per_hour numeric not null default 0,
  category text default 'Uncategorized',
  target_duration_minutes integer,
  target_type text check (target_type in ('min', 'max')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Activity Logs
create table if not exists public.activity_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  date date not null default current_date,
  activity_id uuid references public.activities(id),
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  duration_minutes numeric not null default 0,
  calories_burned numeric not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies for Activities
alter table public.activities enable row level security;
alter table public.activity_logs enable row level security;

-- Activities
drop policy if exists "Allow public activities read access" on public.activities;
create policy "Allow public activities read access" on public.activities for select using (user_id is null or auth.uid() = user_id);

drop policy if exists "Allow users to manage own activities" on public.activities;
create policy "Allow users to manage own activities" on public.activities for all using (auth.uid() = user_id);

-- Activity Logs
drop policy if exists "Allow users to manage own activity logs" on public.activity_logs;
create policy "Allow users to manage own activity logs" on public.activity_logs for all using (auth.uid() = user_id);

-- Workouts
create table if not exists public.workout_exercises_def ( -- Renamed to better clarify. This is the exercise library
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id), -- Null means global/public exercise
  source_id text,
  name text not null,
  muscle_group text, -- 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Other'
  equipment text, -- 'Barbell', 'Dumbbell', 'Machine', 'Bodyweight', 'Cable', 'Other'
  video_path text,
  thumbnail_path text,
  primary_metric text default 'reps_weight', -- 'reps_weight', 'time_weight', 'time_distance', 'time'
  secondary_muscle_groups text[] default '{}',
  metric_type text default 'weight_reps',
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
  reps_min numeric,
  reps_max numeric,
  distance numeric, -- in meters or km? let's stick to standard unit (e.g. km or meters)
  duration_seconds integer,
  rpe numeric, -- Rate of Perceived Exertion (1-10)
  is_warmup boolean default false,
  completed boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.workout_routines (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  name text not null,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.workout_routine_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  routine_id uuid references public.workout_routines(id) on delete cascade not null,
  exercise_id uuid references public.workout_exercises_def(id) not null,
  sort_order integer not null default 0,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.workout_routine_sets (
  id uuid default gen_random_uuid() primary key,
  routine_entry_id uuid references public.workout_routine_entries(id) on delete cascade not null,
  set_number integer not null default 1,
  weight numeric,
  reps_min numeric,
  reps_max numeric,
  distance numeric,
  duration_seconds integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.workout_rest_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  exercise_id uuid references public.workout_exercises_def(id) on delete cascade not null,
  rest_seconds integer not null default 60 check (rest_seconds >= 0),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (user_id, exercise_id)
);

-- RLS Policies
alter table public.workout_exercises_def enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_log_entries enable row level security;
alter table public.workout_sets enable row level security;
alter table public.workout_rest_preferences enable row level security;
alter table public.workout_routines enable row level security;
alter table public.workout_routine_entries enable row level security;
alter table public.workout_routine_sets enable row level security;

-- Exercises: Public readout + User private
create policy "Allow public exercises read access" on public.workout_exercises_def for select using (user_id is null or auth.uid() = user_id);
create policy "Allow users to manage own exercises" on public.workout_exercises_def for all using (auth.uid() = user_id);

-- Workouts: User private
create policy "Allow users to manage own workouts" on public.workouts for all using (auth.uid() = user_id);

-- Entries: User private (via workout ownership, but safer to be specific or join)
create policy "Allow users to manage own entries" on public.workout_log_entries for all using (auth.uid() = user_id);

-- Sets: User private
create policy "Allow users to manage own sets" on public.workout_sets for all using (
    exists (
        select 1 from public.workout_log_entries wle
        where wle.id = workout_log_entry_id and wle.user_id = auth.uid()
    )
);

create policy "Allow users to manage own workout rest preferences" on public.workout_rest_preferences for all using (auth.uid() = user_id);

create policy "Allow users to manage own workout routines" on public.workout_routines for all using (auth.uid() = user_id);

create policy "Allow users to manage own workout routine entries" on public.workout_routine_entries for all using (auth.uid() = user_id);

create policy "Allow users to manage own workout routine sets" on public.workout_routine_sets for all using (
  exists (
    select 1 from public.workout_routine_entries wre
    where wre.id = routine_entry_id and wre.user_id = auth.uid()
  )
);
