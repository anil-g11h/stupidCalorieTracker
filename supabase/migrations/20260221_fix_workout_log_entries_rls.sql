alter table if exists public.workout_log_entries
  add column if not exists user_id uuid references auth.users(id);

update public.workout_log_entries wle
set user_id = w.user_id
from public.workouts w
where w.id = wle.workout_id
  and wle.user_id is null;

drop policy if exists "Allow users to manage own entries" on public.workout_log_entries;
drop policy if exists "Allow users to read own entries" on public.workout_log_entries;
drop policy if exists "Allow users to insert own entries" on public.workout_log_entries;
drop policy if exists "Allow users to update own entries" on public.workout_log_entries;
drop policy if exists "Allow users to delete own entries" on public.workout_log_entries;

create policy "Allow users to read own entries"
on public.workout_log_entries
for select
using (
  (
    user_id = auth.uid()
    or exists (
      select 1
      from public.workouts w
      where w.id = workout_id
        and w.user_id = auth.uid()
    )
  )
);

create policy "Allow users to insert own entries"
on public.workout_log_entries
for insert
with check (
  (
    coalesce(user_id, auth.uid()) = auth.uid()
    and exists (
      select 1
      from public.workouts w
      where w.id = workout_id
        and w.user_id = auth.uid()
    )
  )
);

create policy "Allow users to update own entries"
on public.workout_log_entries
for update
using (
  (
    user_id = auth.uid()
    or exists (
      select 1
      from public.workouts w
      where w.id = workout_id
        and w.user_id = auth.uid()
    )
  )
)
with check (
  (
    coalesce(user_id, auth.uid()) = auth.uid()
    and exists (
      select 1
      from public.workouts w
      where w.id = workout_id
        and w.user_id = auth.uid()
    )
  )
);

create policy "Allow users to delete own entries"
on public.workout_log_entries
for delete
using (
  (
    user_id = auth.uid()
    or exists (
      select 1
      from public.workouts w
      where w.id = workout_id
        and w.user_id = auth.uid()
    )
  )
);

drop policy if exists "Allow users to manage own sets" on public.workout_sets;
drop policy if exists "Allow users to read own sets" on public.workout_sets;
drop policy if exists "Allow users to insert own sets" on public.workout_sets;
drop policy if exists "Allow users to update own sets" on public.workout_sets;
drop policy if exists "Allow users to delete own sets" on public.workout_sets;

create policy "Allow users to read own sets"
on public.workout_sets
for select
using (
  exists (
    select 1
    from public.workout_log_entries wle
    join public.workouts w on w.id = wle.workout_id
    where wle.id = workout_log_entry_id
      and w.user_id = auth.uid()
  )
);

create policy "Allow users to insert own sets"
on public.workout_sets
for insert
with check (
  exists (
    select 1
    from public.workout_log_entries wle
    join public.workouts w on w.id = wle.workout_id
    where wle.id = workout_log_entry_id
      and w.user_id = auth.uid()
  )
);

create policy "Allow users to update own sets"
on public.workout_sets
for update
using (
  exists (
    select 1
    from public.workout_log_entries wle
    join public.workouts w on w.id = wle.workout_id
    where wle.id = workout_log_entry_id
      and w.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_log_entries wle
    join public.workouts w on w.id = wle.workout_id
    where wle.id = workout_log_entry_id
      and w.user_id = auth.uid()
  )
);

create policy "Allow users to delete own sets"
on public.workout_sets
for delete
using (
  exists (
    select 1
    from public.workout_log_entries wle
    join public.workouts w on w.id = wle.workout_id
    where wle.id = workout_log_entry_id
      and w.user_id = auth.uid()
  )
);
