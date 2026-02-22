begin;

create temporary table tmp_workout_exercise_duplicate_map on commit drop as
with ranked as (
  select
    id,
    user_id,
    row_number() over (
      partition by user_id, lower(btrim(name))
      order by created_at asc, id asc
    ) as row_num,
    first_value(id) over (
      partition by user_id, lower(btrim(name))
      order by created_at asc, id asc
    ) as keep_id
  from public.workout_exercises_def
)
select
  id as duplicate_id,
  keep_id
from ranked
where row_num > 1;

delete from public.workout_rest_preferences wrp
using tmp_workout_exercise_duplicate_map dm
where wrp.exercise_id = dm.duplicate_id
  and exists (
    select 1
    from public.workout_rest_preferences keeper
    where keeper.user_id = wrp.user_id
      and keeper.exercise_id = dm.keep_id
  );

update public.workout_log_entries wle
set exercise_id = dm.keep_id
from tmp_workout_exercise_duplicate_map dm
where wle.exercise_id = dm.duplicate_id;

update public.workout_routine_entries wre
set exercise_id = dm.keep_id
from tmp_workout_exercise_duplicate_map dm
where wre.exercise_id = dm.duplicate_id;

update public.workout_rest_preferences wrp
set exercise_id = dm.keep_id
from tmp_workout_exercise_duplicate_map dm
where wrp.exercise_id = dm.duplicate_id;

delete from public.workout_exercises_def e
using tmp_workout_exercise_duplicate_map dm
where e.id = dm.duplicate_id;

create unique index if not exists workout_exercises_def_uq_global_normalized_name
  on public.workout_exercises_def (lower(btrim(name)))
  where user_id is null;

create unique index if not exists workout_exercises_def_uq_user_normalized_name
  on public.workout_exercises_def (user_id, lower(btrim(name)))
  where user_id is not null;

commit;
