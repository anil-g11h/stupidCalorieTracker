import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PlusIcon, TrashIcon, CaretLeftIcon } from '@phosphor-icons/react';
import { db, type WorkoutExerciseDef, type WorkoutRoutineSet } from '../../../lib/db';
import { generateId } from '../../../lib';
import { useStackNavigation } from '../../../lib/useStackNavigation';
import { DurationScrollerInput, getMetricColumns, type MetricField } from '../components/WorkoutSetComponents';

export default function RoutineEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const routineId = id === 'new' ? null : (id || null);
  const fromWorkoutId = searchParams.get('fromWorkoutId');
  const navigate = useNavigate();
  const { push, pop } = useStackNavigation();

  const [resolvedRoutineId, setResolvedRoutineId] = useState<string | null>(routineId);
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftFromWorkout, setIsDraftFromWorkout] = useState(false);
  const [hasSavedRoutine, setHasSavedRoutine] = useState(false);

  useEffect(() => {
    setResolvedRoutineId(routineId);
    setIsDraftFromWorkout(false);
    setHasSavedRoutine(false);
  }, [routineId]);

  const cloneWorkoutIntoRoutine = useCallback(async (sourceWorkoutId: string, targetRoutineId: string) => {
    const sourceEntries = await db.workout_log_entries
      .where('workout_id')
      .equals(sourceWorkoutId)
      .sortBy('sort_order');

    if (!sourceEntries.length) return;

    const sourceEntryIds = sourceEntries.map((entry) => entry.id);
    const sourceSets = sourceEntryIds.length
      ? await db.workout_sets.where('workout_log_entry_id').anyOf(sourceEntryIds).toArray()
      : [];

    const setsByEntryId = sourceSets.reduce<Record<string, typeof sourceSets>>((acc, set) => {
      if (!acc[set.workout_log_entry_id]) acc[set.workout_log_entry_id] = [];
      acc[set.workout_log_entry_id].push(set);
      return acc;
    }, {});

    Object.values(setsByEntryId).forEach((entrySets) => {
      entrySets.sort((a, b) => a.set_number - b.set_number);
    });

    const now = new Date();
    for (const entry of sourceEntries) {
      const routineEntryId = generateId();
      await db.workout_routine_entries.add({
        id: routineEntryId,
        routine_id: targetRoutineId,
        exercise_id: entry.exercise_id,
        sort_order: entry.sort_order,
        notes: entry.notes,
        created_at: now,
        synced: 0,
      });

      const copiedSets = setsByEntryId[entry.id] || [];
      for (const copiedSet of copiedSets) {
        await db.workout_routine_sets.add({
          id: generateId(),
          routine_entry_id: routineEntryId,
          set_number: copiedSet.set_number,
          weight: copiedSet.weight,
          reps_min: copiedSet.reps,
          reps_max: copiedSet.reps,
          distance: copiedSet.distance,
          duration_seconds: copiedSet.duration_seconds,
          created_at: now,
          synced: 0,
        });
      }
    }
  }, []);

  const ensureRoutineExists = useCallback(async () => {
    if (resolvedRoutineId) return resolvedRoutineId;

    const newRoutineId = generateId();
    const now = new Date();
    let nextName = 'New Routine';

    if (fromWorkoutId) {
      const sourceWorkout = await db.workouts.get(fromWorkoutId);
      const sourceName = sourceWorkout?.name?.trim() || 'Workout';
      nextName = `${sourceName} Routine`;
    }

    await db.workout_routines.add({
      id: newRoutineId,
      user_id: 'local-user',
      name: nextName,
      created_at: now,
      updated_at: now,
      synced: 0,
    });

    if (fromWorkoutId) {
      await cloneWorkoutIntoRoutine(fromWorkoutId, newRoutineId);
      setIsDraftFromWorkout(true);
    }

    setResolvedRoutineId(newRoutineId);
    navigate(`/workouts/routines/${newRoutineId}`, { replace: true });
    return newRoutineId;
  }, [cloneWorkoutIntoRoutine, fromWorkoutId, navigate, resolvedRoutineId]);

  useEffect(() => {
    if (routineId) return;
    void ensureRoutineExists();
  }, [routineId, ensureRoutineExists]);

  useEffect(() => {
    return () => {
      if (!resolvedRoutineId || !isDraftFromWorkout || hasSavedRoutine) return;

      void db.transaction('rw', [db.workout_routines, db.workout_routine_entries, db.workout_routine_sets], async () => {
        const entryIds = (await db.workout_routine_entries.where('routine_id').equals(resolvedRoutineId).toArray()).map((entry) => entry.id);
        if (entryIds.length) {
          await db.workout_routine_sets.where('routine_entry_id').anyOf(entryIds).delete();
        }
        await db.workout_routine_entries.where('routine_id').equals(resolvedRoutineId).delete();
        await db.workout_routines.delete(resolvedRoutineId);
      });
    };
  }, [hasSavedRoutine, isDraftFromWorkout, resolvedRoutineId]);

  const routine = useLiveQuery(
    () => (resolvedRoutineId ? db.workout_routines.get(resolvedRoutineId) : undefined),
    [resolvedRoutineId]
  );

  const entries = useLiveQuery(
    () => (resolvedRoutineId ? db.workout_routine_entries.where('routine_id').equals(resolvedRoutineId).sortBy('sort_order') : []),
    [resolvedRoutineId]
  );

  const definitions = useLiveQuery(async () => {
    const defs = await db.workout_exercises_def.toArray();
    return defs.reduce((acc: Record<string, WorkoutExerciseDef>, current) => {
      acc[current.id] = current;
      return acc;
    }, {});
  }, []);

  const setsByEntry = useLiveQuery(async () => {
    if (!entries?.length) return {} as Record<string, WorkoutRoutineSet[]>;

    const entryIds = entries.map((entry) => entry.id);
    const sets = await db.workout_routine_sets.where('routine_entry_id').anyOf(entryIds).toArray();
    const mapped = entries.reduce((acc: Record<string, WorkoutRoutineSet[]>, entry) => {
      acc[entry.id] = [];
      return acc;
    }, {});

    sets.forEach((set) => {
      if (mapped[set.routine_entry_id]) mapped[set.routine_entry_id].push(set);
    });

    Object.keys(mapped).forEach((entryId) => {
      mapped[entryId].sort((a, b) => a.set_number - b.set_number);
    });

    return mapped;
  }, [entries]);

  const summary = useMemo(() => {
    const exerciseCount = entries?.length || 0;
    const setCount = Object.values(setsByEntry || {}).flat().length;
    return { exerciseCount, setCount };
  }, [entries, setsByEntry]);

  const handleNameChange = async (name: string) => {
    if (!resolvedRoutineId) return;
    await db.workout_routines.update(resolvedRoutineId, {
      name,
      updated_at: new Date(),
      synced: 0,
    });
  };

  const handleAddExercise = async () => {
    const id = await ensureRoutineExists();
    push(`/workouts/exercises?routineId=${encodeURIComponent(id)}`);
  };

  const handleAddSet = async (entryId: string) => {
    const currentSets = setsByEntry?.[entryId] || [];
    const lastSet = currentSets[currentSets.length - 1];

    await db.workout_routine_sets.add({
      id: generateId(),
      routine_entry_id: entryId,
      set_number: currentSets.length + 1,
      weight: lastSet?.weight ?? 0,
      reps_min: lastSet?.reps_min ?? 8,
      reps_max: lastSet?.reps_max ?? 10,
      distance: lastSet?.distance,
      duration_seconds: lastSet?.duration_seconds,
      created_at: new Date(),
      synced: 0,
    });
  };

  const handleRemoveEntry = async (entryId: string) => {
    if (!resolvedRoutineId) return;
    if (!window.confirm('Remove this exercise from routine?')) return;

    await db.transaction('rw', [db.workout_routine_entries, db.workout_routine_sets], async () => {
      await db.workout_routine_sets.where('routine_entry_id').equals(entryId).delete();
      await db.workout_routine_entries.delete(entryId);

      const remaining = await db.workout_routine_entries.where('routine_id').equals(resolvedRoutineId).sortBy('sort_order');
      for (let index = 0; index < remaining.length; index += 1) {
        const entry = remaining[index];
        const nextSortOrder = index + 1;
        if (entry.sort_order !== nextSortOrder) {
          await db.workout_routine_entries.update(entry.id, { sort_order: nextSortOrder, synced: 0 });
        }
      }
    });
  };

  const handleDeleteSet = async (entryId: string, setId: string) => {
    const currentSets = setsByEntry?.[entryId] || [];
    if (currentSets.length <= 1) return;

    await db.transaction('rw', db.workout_routine_sets, async () => {
      await db.workout_routine_sets.delete(setId);
      const remaining = await db.workout_routine_sets.where('routine_entry_id').equals(entryId).sortBy('set_number');

      for (let index = 0; index < remaining.length; index += 1) {
        const set = remaining[index];
        const nextNumber = index + 1;
        if (set.set_number !== nextNumber) {
          await db.workout_routine_sets.update(set.id, { set_number: nextNumber, synced: 0 });
        }
      }
    });
  };

  const handleSaveRoutine = async () => {
    setIsSaving(true);
    try {
      const activeRoutineId = await ensureRoutineExists();
      if (!activeRoutineId) return;

      const existing = await db.workout_routines.get(activeRoutineId);
      await db.workout_routines.update(activeRoutineId, {
        name: existing?.name?.trim() || 'New Routine',
        updated_at: new Date(),
        synced: 0,
      });

      setHasSavedRoutine(true);

      pop('/workouts');
    } catch (error) {
      console.error('Failed to save routine:', error);
      alert('Could not save this routine.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateNumericField = (setId: string, field: MetricField, value: number) => {
    if (!field || field === 'reps') return;
    void db.workout_routine_sets.update(setId, { [field]: value, synced: 0 });
  };

  const renderRoutineFieldInput = (set: WorkoutRoutineSet, field: MetricField) => {
    if (!field) {
      return <div className="h-10 flex items-center justify-center text-text-muted">-</div>;
    }

    if (field === 'duration_seconds') {
      return (
        <DurationScrollerInput
          valueSeconds={Number(set.duration_seconds ?? 0)}
          onChange={(nextSeconds) => updateNumericField(set.id, field, nextSeconds)}
        />
      );
    }

    if (field === 'reps') {
      return (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
          <input
            type="number"
            value={set.reps_min ?? 0}
            onChange={(event) => {
              const nextMin = Number(event.target.value);
              const nextMax = Math.max(nextMin, Number(set.reps_max ?? nextMin));
              void db.workout_routine_sets.update(set.id, { reps_min: nextMin, reps_max: nextMax, synced: 0 });
            }}
            className="w-full rounded-md border border-border-subtle bg-card px-2 py-2 text-center text-sm font-semibold"
          />
          <span className="text-xs font-bold text-text-muted">-</span>
          <input
            type="number"
            value={set.reps_max ?? 0}
            onChange={(event) => {
              const nextMax = Number(event.target.value);
              const nextMin = Math.min(Number(set.reps_min ?? nextMax), nextMax);
              void db.workout_routine_sets.update(set.id, { reps_min: nextMin, reps_max: nextMax, synced: 0 });
            }}
            className="w-full rounded-md border border-border-subtle bg-card px-2 py-2 text-center text-sm font-semibold"
          />
        </div>
      );
    }

    return (
      <input
        type="number"
        value={Number((set as any)[field] ?? 0)}
        onChange={(event) => updateNumericField(set.id, field, Number(event.target.value))}
        className="w-full rounded-md border border-border-subtle bg-card px-2 py-2 text-center text-sm font-semibold"
      />
    );
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-md mx-auto bg-background min-h-screen">
      <header className="mb-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <button onClick={() => pop('/workouts')} className="h-9 w-9 rounded-lg border border-border-subtle bg-surface text-text-main flex items-center justify-center">
            <CaretLeftIcon size={16} />
          </button>
          <h1 className="text-lg font-bold text-text-main">Routine Builder</h1>
          <button
            onClick={handleSaveRoutine}
            disabled={isSaving}
            className="bg-brand text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <input
          value={routine?.name || ''}
          onChange={(event) => void handleNameChange(event.target.value)}
          placeholder="Routine name"
          className="w-full rounded-xl border border-border-subtle bg-card px-3 py-3 text-base font-semibold text-text-main"
        />
        <p className="mt-2 text-xs font-medium text-text-muted">
          {summary.exerciseCount} exercise{summary.exerciseCount === 1 ? '' : 's'} • {summary.setCount} set{summary.setCount === 1 ? '' : 's'}
        </p>
      </header>

      {!entries ? (
        <p className="text-sm text-text-muted">Loading routine...</p>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-subtle p-5 text-center">
          <p className="font-semibold text-text-main">No exercises yet</p>
          <p className="text-xs text-text-muted mt-1">Add exercises, then set target weight and rep range.</p>
          <button
            onClick={handleAddExercise}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand text-white px-4 py-2 text-sm font-bold"
          >
            <PlusIcon size={16} />
            Add Exercise
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const def = definitions?.[entry.exercise_id];
            const entrySets = setsByEntry?.[entry.id] || [];
            const metricColumns = getMetricColumns(def?.metric_type);
            const isDurationOnlyMetric = metricColumns.first.field === 'duration_seconds' && metricColumns.second.field === null;

            return (
              <div key={entry.id} className="rounded-2xl border border-border-subtle bg-card p-4">
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div>
                    <h3 className="font-bold text-text-main">{def?.name || 'Exercise'}</h3>
                    <p className="text-xs text-text-muted mt-1">{def?.muscle_group || 'General'} • target sets</p>
                  </div>
                  <button
                    onClick={() => void handleRemoveEntry(entry.id)}
                    className="h-8 w-8 rounded-lg border border-border-subtle bg-surface text-red-500 flex items-center justify-center"
                    aria-label="Remove exercise"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-center text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    <span className="col-span-1 text-center">Set</span>
                    {isDurationOnlyMetric ? (
                      <span className="col-span-9 text-center">{metricColumns.first.label}</span>
                    ) : (
                      <>
                        <span className="col-span-4 text-center">{metricColumns.first.label}</span>
                        <span className="col-span-5 text-center">{metricColumns.second.label}</span>
                      </>
                    )}
                    <span className="col-span-2 text-center">Del</span>
                  </div>

                  {entrySets.map((set) => (
                    <div key={set.id} className="grid grid-cols-12 gap-2 items-center bg-surface rounded-lg p-2">
                      <span className="col-span-1 text-center text-xs font-bold text-text-muted">{set.set_number}</span>
                      {isDurationOnlyMetric ? (
                        <div className="col-span-9">
                          {renderRoutineFieldInput(set, metricColumns.first.field)}
                        </div>
                      ) : (
                        <>
                          <div className="col-span-4">
                            {renderRoutineFieldInput(set, metricColumns.first.field)}
                          </div>
                          <div className="col-span-5">
                            {renderRoutineFieldInput(set, metricColumns.second.field)}
                          </div>
                        </>
                      )}
                      <button
                        onClick={() => void handleDeleteSet(entry.id, set.id)}
                        className="col-span-2 h-8 w-8 mx-auto rounded-md border border-border-subtle bg-card text-text-muted flex items-center justify-center disabled:opacity-40"
                        disabled={entrySets.length <= 1}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => void handleAddSet(entry.id)}
                  className="mt-3 w-full rounded-xl border border-border-subtle bg-surface py-2 text-sm font-semibold text-brand"
                >
                  Add Set
                </button>
              </div>
            );
          })}

          <button
            onClick={handleAddExercise}
            className="w-full rounded-2xl border-2 border-dashed border-border-subtle py-4 text-sm font-bold text-brand flex items-center justify-center gap-2"
          >
            <PlusIcon size={16} />
            Add Exercise
          </button>
        </div>
      )}
    </div>
  );
}
