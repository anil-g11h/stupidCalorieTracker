import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarbellIcon, TrashIcon } from '@phosphor-icons/react';
import { db, type Workout, type WorkoutLogEntry } from '../db';

type ActiveWorkoutDetails = {
    workout: Workout;
    currentEntry: WorkoutLogEntry | null;
    currentExerciseName: string | null;
};

const formatDuration = (startTime: string, nowMs: number) => {
    const diffSeconds = Math.max(0, Math.floor((nowMs - new Date(startTime).getTime()) / 1000));
    const hours = Math.floor(diffSeconds / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export default function ActiveWorkoutBanner() {
    const navigate = useNavigate();
    const location = useLocation();
    const [nowMs, setNowMs] = useState(() => Date.now());

    React.useEffect(() => {
        const interval = window.setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => window.clearInterval(interval);
    }, []);

    const activeWorkout = useLiveQuery(async () => {
        const workouts = await db.workouts.toArray();
        const unfinished = workouts
            .filter((workout) => !workout.end_time)
            .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

        const workout = unfinished[0];
        if (!workout) return null as ActiveWorkoutDetails | null;

        const entries = await db.workout_log_entries
            .where('workout_id')
            .equals(workout.id)
            .sortBy('sort_order');

        const currentEntry = entries.length ? entries[entries.length - 1] : null;
        const currentExercise = currentEntry
            ? await db.workout_exercises_def.get(currentEntry.exercise_id)
            : null;

        return {
            workout,
            currentEntry,
            currentExerciseName: currentExercise?.name || null,
        };
    }, []);

    const isOnWorkoutPage = useMemo(() => {
        if (!activeWorkout?.workout?.id) return false;
        return location.pathname === `/workouts/${activeWorkout.workout.id}`;
    }, [activeWorkout?.workout?.id, location.pathname]);

    if (!activeWorkout || isOnWorkoutPage) return null;

    const duration = formatDuration(activeWorkout.workout.start_time, nowMs);
    const exerciseText = activeWorkout.currentExerciseName || 'No exercise';

    const openWorkout = () => {
        navigate(`/workouts/${activeWorkout.workout.id}`);
    };

    const deleteWorkout = async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const shouldDelete = window.confirm('Delete this in-progress workout?');
        if (!shouldDelete) return;

        await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
            const entryIds = (await db.workout_log_entries.where('workout_id').equals(activeWorkout.workout.id).toArray())
                .map((entry) => entry.id);

            if (entryIds.length) {
                await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).delete();
            }

            await db.workout_log_entries.where('workout_id').equals(activeWorkout.workout.id).delete();
            await db.workouts.delete(activeWorkout.workout.id);
        });
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={openWorkout}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openWorkout();
                }
            }}
            className="fixed left-4 right-4 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-50 max-w-md mx-auto rounded-2xl border border-border-subtle bg-card px-4 py-3 shadow-lg flex items-center gap-3 text-left cursor-pointer"
            aria-label="Open in-progress workout"
        >
            <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
                <BarbellIcon size={20} weight="duotone" />
            </div>

            <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Workout • {duration}</p>
                <p className="text-sm font-semibold text-text-main truncate">{exerciseText}</p>
            </div>

            <button
                type="button"
                onClick={deleteWorkout}
                className="h-9 w-9 rounded-lg border border-border-subtle bg-surface text-text-muted flex items-center justify-center shrink-0"
                aria-label="Delete in-progress workout"
                title="Delete workout"
            >
                <TrashIcon size={16} className="text-red-500" />
            </button>
        </div>
    );
}