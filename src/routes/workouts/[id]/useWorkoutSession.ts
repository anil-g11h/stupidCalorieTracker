import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../lib/db';
import { generateId } from '../../../lib';
import { useNavigate } from 'react-router-dom';
import { useStackNavigation } from '../../../lib/useStackNavigation';

export function useWorkoutSession(workoutId: string | null, isEditingCompleted = false) {
    const navigate = useNavigate();
    const { push, pop } = useStackNavigation();
    const [resolvedWorkoutId, setResolvedWorkoutId] = useState<string | null>(workoutId);
    const creatingWorkoutRef = useRef<Promise<string> | null>(null);

    // --- UI State ---
    const [elapsedTime, setElapsedTime] = useState('00:00');
    const [activeRestTimer, setActiveRestTimer] = useState<any>(null);
    const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);

    const barRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setResolvedWorkoutId(workoutId);
    }, [workoutId]);

    const ensureWorkoutExists = useCallback(async () => {
        if (resolvedWorkoutId) return resolvedWorkoutId;
        if (creatingWorkoutRef.current) return creatingWorkoutRef.current;

        creatingWorkoutRef.current = (async () => {
            const newWorkoutId = generateId();
            await db.workouts.add({
                id: newWorkoutId,
                user_id: 'local-user',
                name: 'Workout',
                start_time: new Date().toISOString(),
                created_at: new Date(),
                synced: 0,
            });
            setResolvedWorkoutId(newWorkoutId);
            navigate(`/workouts/${newWorkoutId}`, { replace: true });
            return newWorkoutId;
        })().finally(() => {
            creatingWorkoutRef.current = null;
        });

        return creatingWorkoutRef.current;
    }, [resolvedWorkoutId, navigate]);

    useEffect(() => {
        if (workoutId) return;
        void ensureWorkoutExists();
    }, [workoutId, ensureWorkoutExists]);

    // --- Database Queries ---
    const workout = useLiveQuery(() => resolvedWorkoutId ? db.workouts.get(resolvedWorkoutId) : undefined, [resolvedWorkoutId]);
    const isReadonlyCompletedWorkout = Boolean(workout?.end_time) && !isEditingCompleted;
    const activeUserId = workout?.user_id || 'local-user';

    const definitions = useLiveQuery(async () => {
        const defs = await db.workout_exercises_def.toArray();
        return defs.reduce((acc: any, d: any) => ({ ...acc, [d.id]: d }), {});
    }, []);

    const exercises = useLiveQuery(() =>
        resolvedWorkoutId ? db.workout_log_entries.where('workout_id').equals(resolvedWorkoutId).sortBy('sort_order') : [],
        [resolvedWorkoutId]
    );

    const sets = useLiveQuery(async () => {
        if (!exercises?.length) return {};
        const entryIds = exercises.map((e: any) => e.id);
        const allSets = await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).toArray();

        const mapped = exercises.reduce((acc: any, e: any) => ({ ...acc, [e.id]: [] }), {});
        allSets.forEach((s: any) => {
            if (mapped[s.workout_log_entry_id]) mapped[s.workout_log_entry_id].push(s);
        });
        Object.keys(mapped).forEach(k => mapped[k].sort((a: any, b: any) => a.set_number - b.set_number));
        return mapped;
    }, [exercises]);

    const restPreferences = useLiveQuery(async () => {
        if (!exercises?.length) return {} as Record<string, number>;

        const exerciseIds = Array.from(new Set(exercises.map((exercise: any) => exercise.exercise_id)));
        if (exerciseIds.length === 0) return {} as Record<string, number>;

        const prefs = await db.workout_rest_preferences
            .where('[user_id+exercise_id]')
            .anyOf(exerciseIds.map((exerciseId) => [activeUserId, exerciseId] as [string, string]))
            .toArray();

        return prefs.reduce((acc: Record<string, number>, pref: any) => {
            acc[pref.exercise_id] = pref.rest_seconds;
            return acc;
        }, {});
    }, [exercises, activeUserId]);

    // --- Computed Stats ---
    const totalStats = useMemo(() => {
        let vol = 0;
        let count = 0;
        if (!sets) return { volume: 0, sets: 0 };
        Object.values(sets).flat().forEach((s: any) => {
            if (s.completed) {
                vol += (s.weight || 0) * (s.reps || 0);
                count++;
            }
        });
        return { volume: vol, sets: count };
    }, [sets]);

    // --- 1. Fix: Rest Timer Logic (functional updates make it move) ---
    useEffect(() => {
        if (!activeRestTimer) return;

        let frameId: number;

        // Inside your update function in the useEffect
        const update = () => {
            if (!activeRestTimer) return;

            const now = Date.now();
            const remainingMs = activeRestTimer.endTime - now;
            const totalMs = activeRestTimer.total * 1000;

            if (remainingMs <= 0) {
                setActiveRestTimer(null);
                return;
            }

            // Calculate progress based on the dynamic total
            const progress = (remainingMs / totalMs) * 100;

            if (barRef.current) {
                // We still cap at 100 just in case of slight timing offsets
                barRef.current.style.width = `${Math.min(100, progress)}%`;
            }

            // Update seconds display...
            requestAnimationFrame(update);
        };

        frameId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(frameId);
    }, [activeRestTimer?.endTime]); // Only restart if the end target changes

    // --- 2. Duration Timer (at top of page) ---
    useEffect(() => {
        if (!workout?.start_time) return;

        const formatDuration = (totalSeconds: number) => {
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            return h > 0
                ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        };

        if (workout.end_time && !isEditingCompleted) {
            const diff = Math.max(
                0,
                Math.floor(
                    (new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()) / 1000
                )
            );
            setElapsedTime(formatDuration(diff));
            return;
        }

        const interval = setInterval(() => {
            const diff = Math.floor((Date.now() - new Date(workout.start_time).getTime()) / 1000);
            setElapsedTime(formatDuration(diff));
        }, 1000);
        return () => clearInterval(interval);
    }, [workout, isEditingCompleted]);

    // --- Actions ---
    const handleAddSet = async (exerciseLogId: string) => {
        const currentSets = sets?.[exerciseLogId] || [];
        const lastSet = currentSets[currentSets.length - 1];
        await db.workout_sets.add({
            id: generateId(),
            workout_log_entry_id: exerciseLogId,
            set_number: currentSets.length + 1,
            weight: lastSet?.weight ?? 0,
            reps: lastSet?.reps ?? lastSet?.reps_max ?? lastSet?.reps_min ?? 0,
            reps_min: lastSet?.reps_min,
            reps_max: lastSet?.reps_max,
            distance: lastSet?.distance ?? 0,
            duration_seconds: lastSet?.duration_seconds ?? 0,
            rpe: lastSet?.rpe,
            is_warmup: lastSet?.is_warmup,
            completed: false,
            created_at: new Date(),
        });
    };

    const cancelWorkout = async () => {
        if (!resolvedWorkoutId || !window.confirm("Discard this workout?")) return;
        await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
            const entryIds = (await db.workout_log_entries.where('workout_id').equals(resolvedWorkoutId).toArray()).map(e => e.id);
            await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).delete();
            await db.workout_log_entries.where('workout_id').equals(resolvedWorkoutId).delete();
            await db.workouts.delete(resolvedWorkoutId);
        });
        navigate('/workouts', { replace: true });
    };

    const adjustRestTimer = (adjustment: number) => {
        setActiveRestTimer((prev: any) => {
            if (!prev) return null;

            // Smooth jump animation
            if (barRef.current) {
                barRef.current.classList.add('is-adjusting');
                setTimeout(() => barRef.current?.classList.remove('is-adjusting'), 300);
            }

            const newRemainingSeconds = Math.max(0, prev.seconds + adjustment);

            // If adding time, we increase the total capacity
            // If subtracting, we keep total as is (or decrease if you prefer)
            const newTotal = adjustment > 0 ? prev.total + adjustment : prev.total;

            return {
                ...prev,
                seconds: newRemainingSeconds,
                endTime: Date.now() + (newRemainingSeconds * 1000),
                total: newTotal
            };
        });
    };
    const skipRestTimer = () => setActiveRestTimer(null);

    const navigateToAddExercises = async () => {
        if (isReadonlyCompletedWorkout) return;
        const activeWorkoutId = await ensureWorkoutExists();
        if (!activeWorkoutId) {
            console.warn('[WorkoutSession] Unable to resolve workout ID for add exercises.');
            return;
        }

        push(`/workouts/exercises?workoutId=${encodeURIComponent(activeWorkoutId)}`);
    };

    const handleRemoveExercise = async (entryId: string) => {
        if (isReadonlyCompletedWorkout || !resolvedWorkoutId) return;
        if (!window.confirm('Remove this exercise from workout?')) return;

        await db.transaction('rw', [db.workout_log_entries, db.workout_sets], async () => {
            await db.workout_sets.where('workout_log_entry_id').equals(entryId).delete();
            await db.workout_log_entries.delete(entryId);

            const remaining = await db.workout_log_entries
                .where('workout_id')
                .equals(resolvedWorkoutId)
                .sortBy('sort_order');

            for (let index = 0; index < remaining.length; index += 1) {
                const entry = remaining[index];
                const expectedSortOrder = index + 1;
                if (entry.sort_order !== expectedSortOrder) {
                    await db.workout_log_entries.update(entry.id, { sort_order: expectedSortOrder, synced: 0 });
                }
            }
        });

        setExpandedMenuId(null);
    };

    const handleReorderExercise = async (entryId: string, direction: 'up' | 'down') => {
        if (isReadonlyCompletedWorkout || !resolvedWorkoutId) return;

        const ordered = await db.workout_log_entries
            .where('workout_id')
            .equals(resolvedWorkoutId)
            .sortBy('sort_order');

        const currentIndex = ordered.findIndex((entry) => entry.id === entryId);
        if (currentIndex === -1) return;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= ordered.length) return;

        const currentEntry = ordered[currentIndex];
        const targetEntry = ordered[targetIndex];

        await db.transaction('rw', db.workout_log_entries, async () => {
            await db.workout_log_entries.update(currentEntry.id, { sort_order: targetEntry.sort_order, synced: 0 });
            await db.workout_log_entries.update(targetEntry.id, { sort_order: currentEntry.sort_order, synced: 0 });
        });

        setExpandedMenuId(null);
    };

    const navigateToReplaceExercise = async (entryId: string) => {
        if (isReadonlyCompletedWorkout) return;
        const activeWorkoutId = await ensureWorkoutExists();
        if (!activeWorkoutId) {
            console.warn('[WorkoutSession] Unable to resolve workout ID for replace exercise.');
            return;
        }

        push(
            `/workouts/exercises?workoutId=${encodeURIComponent(activeWorkoutId)}&replaceEntryId=${encodeURIComponent(entryId)}`
        );
    };

    const handleToggleSet = async (setId: string, completed: boolean, entryId: string, defId: string) => {
        if (isReadonlyCompletedWorkout) return;
        const newStatus = !completed;
        await db.workout_sets.update(setId, { completed: newStatus, synced: 0 });

        if (newStatus) {
            const restTime = restPreferences?.[defId] ?? 0;
            if (restTime <= 0) {
                setActiveRestTimer(null);
                return;
            }
            const endTime = Date.now() + restTime * 1000;
            setActiveRestTimer({ exerciseId: entryId, definitionId: defId, seconds: restTime, total: restTime, endTime });
            if ('vibrate' in navigator) navigator.vibrate(40);
        }
    };

    const setExerciseRestPreference = async (exerciseId: string, seconds: number) => {
        if (isReadonlyCompletedWorkout) return;

        const normalizedSeconds = Math.max(0, Math.round(seconds));
        const now = new Date();
        const existing = await db.workout_rest_preferences
            .where('[user_id+exercise_id]')
            .equals([activeUserId, exerciseId])
            .first();

        if (existing) {
            await db.workout_rest_preferences.update(existing.id, {
                rest_seconds: normalizedSeconds,
                updated_at: now,
                synced: 0,
            });
        } else {
            await db.workout_rest_preferences.add({
                id: generateId(),
                user_id: activeUserId,
                exercise_id: exerciseId,
                rest_seconds: normalizedSeconds,
                created_at: now,
                updated_at: now,
                synced: 0,
            });
        }

        setActiveRestTimer((prev: any) => {
            if (!prev || prev.definitionId !== exerciseId) return prev;
            return {
                ...prev,
                seconds: normalizedSeconds,
                total: normalizedSeconds,
                endTime: Date.now() + (normalizedSeconds * 1000),
            };
        });
    };

    const requestFinishWorkout = async () => {
        if (isReadonlyCompletedWorkout) {
            pop('/workouts');
            return false;
        }
        if (!resolvedWorkoutId) return;

        const hasCompletedSets = Object.values(sets || {}).flat().some((s: any) => s.completed);
        if (!hasCompletedSets) {
            if (!window.confirm("You haven't completed any sets. Finish anyway?")) return false;
        }

        return true;
    };

    const saveFinishedWorkout = async ({
        title,
        durationMinutes,
        description,
        stayOnPage = false,
    }: {
        title: string;
        durationMinutes: number;
        description: string;
        stayOnPage?: boolean;
    }) => {
        if (!resolvedWorkoutId || !workout?.start_time) return;

        const startMs = new Date(workout.start_time).getTime();
        const safeDurationMinutes = Number.isFinite(durationMinutes) && durationMinutes >= 0
            ? Math.round(durationMinutes)
            : 0;
        const endTime = new Date(startMs + safeDurationMinutes * 60 * 1000).toISOString();

        try {
            await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
                const sourceEntries = await db.workout_log_entries
                    .where('workout_id')
                    .equals(resolvedWorkoutId)
                    .sortBy('sort_order');

                const sourceEntryIds = sourceEntries.map((entry) => entry.id);
                const sourceSets = sourceEntryIds.length
                    ? await db.workout_sets.where('workout_log_entry_id').anyOf(sourceEntryIds).toArray()
                    : [];

                const completedSetsByEntryId = sourceSets.reduce<Record<string, typeof sourceSets>>((acc, set) => {
                    if (!set.completed) return acc;
                    if (!acc[set.workout_log_entry_id]) acc[set.workout_log_entry_id] = [];
                    acc[set.workout_log_entry_id].push(set);
                    return acc;
                }, {});

                const keepEntryIds = new Set(Object.keys(completedSetsByEntryId));
                const removeEntryIds = sourceEntries
                    .filter((entry) => !keepEntryIds.has(entry.id))
                    .map((entry) => entry.id);

                if (removeEntryIds.length) {
                    await db.workout_sets.where('workout_log_entry_id').anyOf(removeEntryIds).delete();
                    await db.workout_log_entries.where('id').anyOf(removeEntryIds).delete();
                }

                const keepEntries = sourceEntries.filter((entry) => keepEntryIds.has(entry.id));

                for (let entryIndex = 0; entryIndex < keepEntries.length; entryIndex += 1) {
                    const entry = keepEntries[entryIndex];
                    const nextSortOrder = entryIndex + 1;
                    if (entry.sort_order !== nextSortOrder) {
                        await db.workout_log_entries.update(entry.id, { sort_order: nextSortOrder, synced: 0 });
                    }

                    const completedSets = (completedSetsByEntryId[entry.id] || []).sort((a, b) => a.set_number - b.set_number);
                    const keepSetIds = new Set(completedSets.map((set) => set.id));
                    const removeSetIds = sourceSets
                        .filter((set) => set.workout_log_entry_id === entry.id && !keepSetIds.has(set.id))
                        .map((set) => set.id);

                    if (removeSetIds.length) {
                        await db.workout_sets.where('id').anyOf(removeSetIds).delete();
                    }

                    for (let setIndex = 0; setIndex < completedSets.length; setIndex += 1) {
                        const set = completedSets[setIndex];
                        const nextSetNumber = setIndex + 1;
                        if (set.set_number !== nextSetNumber || !set.completed) {
                            await db.workout_sets.update(set.id, {
                                set_number: nextSetNumber,
                                completed: true,
                                synced: 0,
                            });
                        }
                    }
                }

                await db.workouts.update(resolvedWorkoutId, {
                    name: title.trim() || workout.name || 'Workout',
                    notes: description.trim() || undefined,
                    end_time: endTime,
                    updated_at: new Date(),
                    synced: 0
                });
            });

            if (!stayOnPage) {
                pop('/workouts');
            }
        } catch (error) {
            console.error("Failed to finish workout:", error);
            alert("Error saving workout.");
        }
    };

    const copyWorkout = async () => {
        if (!resolvedWorkoutId || !workout) return;

        try {
            const sourceEntries = await db.workout_log_entries
                .where('workout_id')
                .equals(resolvedWorkoutId)
                .sortBy('sort_order');

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

            const newWorkoutId = generateId();
            const now = new Date();

            await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
                await db.workouts.add({
                    id: newWorkoutId,
                    user_id: workout.user_id || 'local-user',
                    name: workout.name || 'Workout',
                    start_time: now.toISOString(),
                    created_at: now,
                    synced: 0,
                });

                for (const entry of sourceEntries) {
                    const newEntryId = generateId();

                    await db.workout_log_entries.add({
                        id: newEntryId,
                        workout_id: newWorkoutId,
                        exercise_id: entry.exercise_id,
                        sort_order: entry.sort_order,
                        notes: entry.notes,
                        created_at: now,
                        synced: 0,
                    });

                    const copiedSets = setsByEntryId[entry.id] || [];
                    for (const copiedSet of copiedSets) {
                        await db.workout_sets.add({
                            id: generateId(),
                            workout_log_entry_id: newEntryId,
                            set_number: copiedSet.set_number,
                            weight: copiedSet.weight,
                            reps: copiedSet.reps,
                            distance: copiedSet.distance,
                            duration_seconds: copiedSet.duration_seconds,
                            rpe: copiedSet.rpe,
                            is_warmup: copiedSet.is_warmup,
                            completed: false,
                            created_at: now,
                            synced: 0,
                        });
                    }
                }
            });

            push(`/workouts/${newWorkoutId}`);
        } catch (error) {
            console.error('Failed to copy workout:', error);
            alert('Error copying workout.');
        }
    };

    const saveWorkoutAsRoutine = async () => {
        if (!resolvedWorkoutId || !workout) return;

        try {
            const sourceEntries = await db.workout_log_entries
                .where('workout_id')
                .equals(resolvedWorkoutId)
                .sortBy('sort_order');

            if (!sourceEntries.length) {
                alert('No exercises to save as routine.');
                return;
            }

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
            const routineId = generateId();
            const baseName = (workout.name || 'Workout').trim() || 'Workout';

            await db.transaction('rw', [db.workout_routines, db.workout_routine_entries, db.workout_routine_sets], async () => {
                await db.workout_routines.add({
                    id: routineId,
                    user_id: workout.user_id || 'local-user',
                    name: `${baseName} Routine`,
                    notes: workout.notes,
                    created_at: now,
                    updated_at: now,
                    synced: 0,
                });

                for (const entry of sourceEntries) {
                    const routineEntryId = generateId();
                    await db.workout_routine_entries.add({
                        id: routineEntryId,
                        routine_id: routineId,
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
            });

            alert('Workout saved as routine.');
        } catch (error) {
            console.error('Failed to save workout as routine:', error);
            alert('Error saving routine.');
        }
    };

    const deleteWorkout = async () => {
        if (!resolvedWorkoutId) return;
        if (!window.confirm('Delete this workout? This cannot be undone.')) return;

        try {
            await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
                const entryIds = (await db.workout_log_entries.where('workout_id').equals(resolvedWorkoutId).toArray()).map((entry) => entry.id);
                if (entryIds.length) {
                    await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).delete();
                }
                await db.workout_log_entries.where('workout_id').equals(resolvedWorkoutId).delete();
                await db.workouts.delete(resolvedWorkoutId);
            });

            pop('/workouts');
        } catch (error) {
            console.error('Failed to delete workout:', error);
            alert('Error deleting workout.');
        }
    };

    return {
        workout, exercises, definitions, sets, totalStats,
        elapsedTime, activeRestTimer, expandedMenuId,
        setExpandedMenuId, handleAddSet, cancelWorkout,
        adjustRestTimer, skipRestTimer, navigateToAddExercises,
        handleRemoveExercise, handleReorderExercise, navigateToReplaceExercise,
        requestFinishWorkout, saveFinishedWorkout, copyWorkout, saveWorkoutAsRoutine, deleteWorkout, handleToggleSet,
        restPreferences: restPreferences || {}, setExerciseRestPreference, barRef,
    };
}