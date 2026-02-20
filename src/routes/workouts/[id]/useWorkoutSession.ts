import { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../lib/db';
import { generateId } from '../../../lib';
import { useNavigate } from 'react-router-dom';
import { useStackNavigation } from '../../../lib/useStackNavigation';

export function useWorkoutSession(workoutId: string | null) {
    const navigate = useNavigate();
    const { push, pop } = useStackNavigation();

    // --- UI State ---
    const [elapsedTime, setElapsedTime] = useState('00:00');
    const [activeRestTimer, setActiveRestTimer] = useState<any>(null);
    const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);
    const [restPreferences, setRestPreferences] = useState<Record<string, number>>({});

    const barRef = useRef<HTMLDivElement>(null);

    // --- Database Queries ---
    const workout = useLiveQuery(() => workoutId ? db.workouts.get(workoutId) : undefined, [workoutId]);

    const definitions = useLiveQuery(async () => {
        const defs = await db.workout_exercises_def.toArray();
        return defs.reduce((acc: any, d: any) => ({ ...acc, [d.id]: d }), {});
    }, []);

    const exercises = useLiveQuery(() =>
        workoutId ? db.workout_log_entries.where('workout_id').equals(workoutId).sortBy('sort_order') : [],
        [workoutId]
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
        if (!workout?.start_time || workout.end_time) return;
        const interval = setInterval(() => {
            const diff = Math.floor((Date.now() - new Date(workout.start_time).getTime()) / 1000);
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            setElapsedTime(h > 0
                ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
        }, 1000);
        return () => clearInterval(interval);
    }, [workout]);

    // --- Actions ---
    const handleAddSet = async (exerciseLogId: string) => {
        const currentSets = sets?.[exerciseLogId] || [];
        const lastSet = currentSets[currentSets.length - 1];
        await db.workout_sets.add({
            id: generateId(),
            workout_log_entry_id: exerciseLogId,
            set_number: currentSets.length + 1,
            weight: lastSet?.weight || 0,
            reps: lastSet?.reps || 0,
            completed: false,
            created_at: new Date(),
        });
    };

    const cancelWorkout = async () => {
        if (!workoutId || !window.confirm("Discard this workout?")) return;
        await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
            const entryIds = (await db.workout_log_entries.where('workout_id').equals(workoutId).toArray()).map(e => e.id);
            await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).delete();
            await db.workout_log_entries.where('workout_id').equals(workoutId).delete();
            await db.workouts.delete(workoutId);
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

    const navigateToAddExercises = () => {
        push(`/workouts/exercises?workoutId=${workoutId}`);
    };

    const handleToggleSet = async (setId: string, completed: boolean, entryId: string, defId: string) => {
        const newStatus = !completed;
        await db.workout_sets.update(setId, { completed: newStatus, synced: 0 });

        if (newStatus) {
            const restTime = restPreferences[defId] || 60;
            const endTime = Date.now() + restTime * 1000;
            setActiveRestTimer({ exerciseId: entryId, seconds: restTime, total: restTime, endTime });
            if ('vibrate' in navigator) navigator.vibrate(40);
        }
    };

    const finishWorkout = async () => {
        if (!workoutId) return;

        const hasCompletedSets = Object.values(sets || {}).flat().some((s: any) => s.completed);
        if (!hasCompletedSets) {
            if (!window.confirm("You haven't completed any sets. Finish anyway?")) return;
        }

        try {
            await db.workouts.update(workoutId, {
                end_time: new Date().toISOString(),
                synced: 0
            });

            // Use 'pop' which already handles the View Transition logic
            pop('/workouts');
        } catch (error) {
            console.error("Failed to finish workout:", error);
            alert("Error saving workout.");
        }
    };

    return {
        workout, exercises, definitions, sets, totalStats,
        elapsedTime, activeRestTimer, expandedMenuId,
        setExpandedMenuId, handleAddSet, cancelWorkout,
        adjustRestTimer, skipRestTimer, navigateToAddExercises,
        finishWorkout, handleToggleSet, barRef,
    };
}