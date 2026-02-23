import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { PlayIcon, PlusIcon, WrenchIcon, GlobeSimpleIcon } from '@phosphor-icons/react';
import { db } from '../../lib/db';
import { startRoutineAsWorkout } from '../../lib/routines';
import { useStackNavigation } from '../../lib/useStackNavigation';

type RoutineSummary = {
  exercises: number;
  sets: number;
};

const isLocalRoutine = (userId?: string) => !userId || userId === 'local-user' || userId === 'current-user';

export default function WorkoutStart() {
  const { push } = useStackNavigation();
  const [startingRoutineId, setStartingRoutineId] = React.useState<string | null>(null);

  const routines = useLiveQuery(
    () => db.workout_routines.orderBy('updated_at').reverse().toArray(),
    []
  );

  const routineSummaries = useLiveQuery(async () => {
    if (!routines?.length) return {} as Record<string, RoutineSummary>;

    const routineIds = routines.map((routine) => routine.id);
    const entries = await db.workout_routine_entries.where('routine_id').anyOf(routineIds).toArray();
    const entryIds = entries.map((entry) => entry.id);
    const sets = entryIds.length
      ? await db.workout_routine_sets.where('routine_entry_id').anyOf(entryIds).toArray()
      : [];

    const summary: Record<string, RoutineSummary> = {};
    routineIds.forEach((routineId) => {
      summary[routineId] = { exercises: 0, sets: 0 };
    });

    entries.forEach((entry) => {
      if (summary[entry.routine_id]) summary[entry.routine_id].exercises += 1;
    });

    const entryToRoutine = new Map(entries.map((entry) => [entry.id, entry.routine_id]));
    sets.forEach((set) => {
      const routineId = entryToRoutine.get(set.routine_entry_id);
      if (routineId && summary[routineId]) summary[routineId].sets += 1;
    });

    return summary;
  }, [routines]);

  const myRoutines = React.useMemo(
    () => (routines || []).filter((routine) => isLocalRoutine(routine.user_id)),
    [routines]
  );

  const publicRoutines = React.useMemo(
    () => (routines || []).filter((routine) => !isLocalRoutine(routine.user_id)),
    [routines]
  );

  const handleStartRoutine = async (routineId: string) => {
    setStartingRoutineId(routineId);
    try {
      const workoutId = await startRoutineAsWorkout(routineId);
      push(`/workouts/${workoutId}`);
    } catch (error) {
      console.error('Failed to start routine:', error);
      alert('Could not start routine.');
    } finally {
      setStartingRoutineId(null);
    }
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-md mx-auto bg-background min-h-screen">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-text-main mb-2">Start Workout</h1>
        <p className="text-sm text-text-muted">Choose how you want to start.</p>
      </header>

      <section className="space-y-3 mb-6">
        <Link
          to="/workouts/new"
          className="flex items-center justify-between rounded-2xl border border-border-subtle bg-card p-4"
        >
          <div>
            <p className="font-semibold text-text-main">Start Empty Workout</p>
            <p className="text-xs text-text-muted mt-1">Begin from a blank session.</p>
          </div>
          <PlusIcon size={18} className="text-brand" />
        </Link>

        <Link
          to="/workouts/routines/new"
          className="flex items-center justify-between rounded-2xl border border-border-subtle bg-card p-4"
        >
          <div>
            <p className="font-semibold text-text-main">Build New Routine</p>
            <p className="text-xs text-text-muted mt-1">Create and save a routine template.</p>
          </div>
          <WrenchIcon size={18} className="text-brand" />
        </Link>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-2 flex items-center gap-1">
          <GlobeSimpleIcon size={14} /> Explore
        </h2>
        {!routines ? (
          <div className="rounded-xl border border-border-subtle bg-card p-3 text-sm text-text-muted">Loading routines...</div>
        ) : publicRoutines.length === 0 ? (
          <div className="rounded-xl border border-border-subtle bg-card p-3 text-sm text-text-muted">No public routines yet.</div>
        ) : (
          <div className="space-y-2">
            {publicRoutines.map((routine) => {
              const summary = routineSummaries?.[routine.id] || { exercises: 0, sets: 0 };
              return (
                <div key={routine.id} className="rounded-xl border border-border-subtle bg-card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-main truncate">{routine.name || 'Routine'}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {summary.exercises} exercise{summary.exercises === 1 ? '' : 's'} • {summary.sets} set{summary.sets === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleStartRoutine(routine.id)}
                    disabled={startingRoutineId === routine.id || summary.exercises === 0}
                    className="rounded-lg bg-brand text-white text-xs font-bold px-3 py-2 disabled:opacity-50 flex items-center gap-1"
                  >
                    <PlayIcon size={12} />
                    {startingRoutineId === routine.id ? 'Starting...' : 'Start'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-2">My Routines</h2>
        {!routines ? (
          <div className="rounded-xl border border-border-subtle bg-card p-3 text-sm text-text-muted">Loading routines...</div>
        ) : myRoutines.length === 0 ? (
          <div className="rounded-xl border border-border-subtle bg-card p-3 text-sm text-text-muted">You have no routines yet.</div>
        ) : (
          <div className="space-y-2">
            {myRoutines.map((routine) => {
              const summary = routineSummaries?.[routine.id] || { exercises: 0, sets: 0 };
              return (
                <div key={routine.id} className="rounded-xl border border-border-subtle bg-card p-3 flex items-center justify-between gap-3">
                  <Link to={`/workouts/routines/${routine.id}`} className="min-w-0 flex-1">
                    <p className="font-semibold text-text-main truncate">{routine.name || 'Routine'}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {summary.exercises} exercise{summary.exercises === 1 ? '' : 's'} • {summary.sets} set{summary.sets === 1 ? '' : 's'}
                    </p>
                  </Link>
                  <button
                    onClick={() => void handleStartRoutine(routine.id)}
                    disabled={startingRoutineId === routine.id || summary.exercises === 0}
                    className="rounded-lg bg-brand text-white text-xs font-bold px-3 py-2 disabled:opacity-50 flex items-center gap-1"
                  >
                    <PlayIcon size={12} />
                    {startingRoutineId === routine.id ? 'Starting...' : 'Start'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
