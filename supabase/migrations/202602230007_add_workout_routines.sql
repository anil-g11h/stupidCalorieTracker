alter table public.workout_sets
  add column if not exists reps_min numeric,
  add column if not exists reps_max numeric;

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

alter table public.workout_routines enable row level security;
alter table public.workout_routine_entries enable row level security;
alter table public.workout_routine_sets enable row level security;

drop policy if exists "Allow users to manage own workout routines" on public.workout_routines;
create policy "Allow users to manage own workout routines"
on public.workout_routines
for all
using (auth.uid() = user_id);

drop policy if exists "Allow users to manage own workout routine entries" on public.workout_routine_entries;
create policy "Allow users to manage own workout routine entries"
on public.workout_routine_entries
for all
using (auth.uid() = user_id);

drop policy if exists "Allow users to manage own workout routine sets" on public.workout_routine_sets;
create policy "Allow users to manage own workout routine sets"
on public.workout_routine_sets
for all
using (
  exists (
    select 1 from public.workout_routine_entries wre
    where wre.id = routine_entry_id
      and wre.user_id = auth.uid()
  )
);
