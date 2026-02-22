create table if not exists public.workout_rest_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  exercise_id uuid references public.workout_exercises_def(id) on delete cascade not null,
  rest_seconds integer not null default 60 check (rest_seconds >= 0),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (user_id, exercise_id)
);

alter table public.workout_rest_preferences enable row level security;

drop policy if exists "Allow users to manage own workout rest preferences" on public.workout_rest_preferences;
create policy "Allow users to manage own workout rest preferences"
on public.workout_rest_preferences
for all
using (auth.uid() = user_id);
