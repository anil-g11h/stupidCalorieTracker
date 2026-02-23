import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    PlusIcon as PlusIcon,
    MagnifyingGlassIcon as SearchIcon,
    CheckIcon as CheckIcon,
    PlusCircleIcon as CreateIcon
} from '@phosphor-icons/react';
import { db, type WorkoutSet } from '../../../lib/db';
import { generateId } from '../../../lib';
import { useStackNavigation } from '../../../lib/useStackNavigation';
import { syncWorkoutExerciseThumbnailPaths } from '../../../lib/workoutMedia';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Other'];
const EQUIPMENT_TYPES = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'None'];

type WorkoutMediaEntry = {
    sourceId: string;
    videoPath: string;
    thumbnailPath: string | null;
};

type WorkoutMediaMap = {
    media?: WorkoutMediaEntry[];
};

const toWorkoutMediaUrl = (path?: string | null) => {
    if (!path) return '';
    const base = import.meta.env.BASE_URL || '/';
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${normalizedBase}${path.replace(/^\/+/, '')}`;
};

const DEFAULT_EXERCISE_THUMBNAIL_PATH = 'workouts/images/exercise-default-thumb.svg';

const normalizeName = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const mediaNameFromVideoPath = (videoPath: string) => {
    const file = videoPath.split('/').pop() || videoPath;
    const noExt = file.replace(/\.mp4$/i, '');
    const noPrefix = noExt.replace(/^\d+-/, '');
    const noSuffix = noPrefix.replace(/-(chest|back|thighs|shoulders|shoulder|upper-arms|lower-arms|waist|hips|calves|plyometrics)$/i, '');
    const noGender = noSuffix.replace(/-(female|male)$/i, '');
    return normalizeName(noGender.replace(/-/g, ' '));
};

const buildEmptyWorkoutSetDraft = (): Omit<WorkoutSet, 'id' | 'workout_log_entry_id'> => ({
    set_number: 1,
    weight: 0,
    reps: 0,
    distance: 0,
    duration_seconds: 0,
    completed: false,
    created_at: new Date(),
    synced: 0,
});

export default function ExerciseSelector() {
    const [searchParams] = useSearchParams();
    const workoutIdParam = searchParams.get('workoutId');
    const routineIdParam = searchParams.get('routineId');
    const replaceEntryIdParam = searchParams.get('replaceEntryId');
    const workoutId = workoutIdParam && workoutIdParam !== 'null' && workoutIdParam !== 'undefined'
        ? workoutIdParam
        : null;
    const routineId = routineIdParam && routineIdParam !== 'null' && routineIdParam !== 'undefined'
        ? routineIdParam
        : null;
    const replaceEntryId = replaceEntryIdParam && replaceEntryIdParam !== 'null' && replaceEntryIdParam !== 'undefined'
        ? replaceEntryIdParam
        : null;
    const isReplaceMode = Boolean(replaceEntryId && workoutId);
    const { push, pop } = useStackNavigation();
    
    // --- UI State ---
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedMuscleGroup, setSelectedMuscleGroup] = useState('All');
    const [selectedEquipment, setSelectedEquipment] = useState('All');
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [mediaFallbackByExerciseId, setMediaFallbackByExerciseId] = useState<Record<string, { videoPath?: string; thumbnailPath?: string }>>({});
    const [isResettingLocalDb, setIsResettingLocalDb] = useState(false);

    // --- Data Fetching ---
    const allExercises = useLiveQuery(async () => {
        const data = await db.workout_exercises_def.toArray();
        return data;
    }, []);

    // --- Filtering & Sorting ---
    const filteredExercises = useMemo(() => {
        if (!allExercises) return [];

        const lower = searchTerm.toLowerCase();
        return allExercises
            .filter((exercise) => {
                const matchesSearch =
                    exercise.name.toLowerCase().includes(lower) ||
                    (exercise.muscle_group && exercise.muscle_group.toLowerCase().includes(lower));

                const matchesMuscleGroup =
                    selectedMuscleGroup === 'All' ||
                    exercise.muscle_group === selectedMuscleGroup;

                const matchesEquipment =
                    selectedEquipment === 'All' ||
                    exercise.equipment === selectedEquipment;

                return matchesSearch && matchesMuscleGroup && matchesEquipment;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [allExercises, searchTerm, selectedMuscleGroup, selectedEquipment]);

    useEffect(() => {
        let cancelled = false;

        const resolveFallbackMedia = async () => {
            if (!allExercises?.length) {
                setMediaFallbackByExerciseId({});
                return;
            }

            try {
                const response = await fetch(toWorkoutMediaUrl('workouts/media-map.json'), { cache: 'no-cache' });
                if (!response.ok) return;
                const mediaMap = (await response.json()) as WorkoutMediaMap;
                const mediaEntries = mediaMap.media || [];
                void syncWorkoutExerciseThumbnailPaths(mediaEntries);

                const bySourceId = new Map(mediaEntries.map((entry) => [entry.sourceId, entry]));
                const byNormalizedName = mediaEntries.map((entry) => ({
                    entry,
                    normalizedName: mediaNameFromVideoPath(entry.videoPath)
                }));

                const next: Record<string, { videoPath?: string; thumbnailPath?: string }> = {};

                for (const exercise of allExercises) {
                    if (exercise.video_path || exercise.thumbnail_path) continue;

                    let matched: WorkoutMediaEntry | undefined;
                    if (exercise.source_id) {
                        matched = bySourceId.get(exercise.source_id);
                    }

                    if (!matched) {
                        const normalizedExerciseName = normalizeName(exercise.name || '');
                        matched = byNormalizedName.find((item) =>
                            item.normalizedName === normalizedExerciseName ||
                            item.normalizedName.includes(normalizedExerciseName) ||
                            normalizedExerciseName.includes(item.normalizedName)
                        )?.entry;
                    }

                    if (matched) {
                        next[exercise.id] = {
                            videoPath: matched.videoPath,
                            thumbnailPath: matched.thumbnailPath || undefined
                        };
                    }
                }

                if (!cancelled) {
                    setMediaFallbackByExerciseId(next);
                }
            } catch {
                // no-op fallback
            }
        };

        void resolveFallbackMedia();
        return () => {
            cancelled = true;
        };
    }, [allExercises]);

    // --- Handlers ---
    const toggleSelect = (id: string) => {
        if (isReplaceMode) {
            setSelected({ [id]: true });
            return;
        }

        setSelected(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const selectedCount = Object.values(selected).filter(Boolean).length;

    const getDefaultSetsFromPreviousWorkout = async (
        exerciseId: string,
        currentWorkoutId: string
    ): Promise<Array<Omit<WorkoutSet, 'id' | 'workout_log_entry_id'>>> => {
        const exerciseEntries = await db.workout_log_entries.where('exercise_id').equals(exerciseId).toArray();
        const candidateEntries = exerciseEntries.filter((entry) => entry.workout_id !== currentWorkoutId);
        if (!candidateEntries.length) {
            return [buildEmptyWorkoutSetDraft()];
        }

        const workoutIds = Array.from(new Set(candidateEntries.map((entry) => entry.workout_id)));
        const workouts = await db.workouts.where('id').anyOf(workoutIds).toArray();
        const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));

        const latestEntry = candidateEntries
            .filter((entry) => workoutById.has(entry.workout_id))
            .sort((a, b) => {
                const aTime = workoutById.get(a.workout_id)?.start_time || '';
                const bTime = workoutById.get(b.workout_id)?.start_time || '';
                if (aTime === bTime) return b.sort_order - a.sort_order;
                return aTime < bTime ? 1 : -1;
            })[0];

        if (!latestEntry) {
            return [buildEmptyWorkoutSetDraft()];
        }

        const previousSets = await db.workout_sets
            .where('workout_log_entry_id')
            .equals(latestEntry.id)
            .sortBy('set_number');

        if (!previousSets.length) {
            return [buildEmptyWorkoutSetDraft()];
        }

        return previousSets.map((set, index) => ({
            set_number: index + 1,
            weight: set.weight,
            reps: set.reps,
            reps_min: set.reps_min,
            reps_max: set.reps_max,
            distance: set.distance,
            duration_seconds: set.duration_seconds,
            rpe: set.rpe,
            is_warmup: set.is_warmup,
            completed: false,
            created_at: new Date(),
            synced: 0,
        }));
    };

    async function addSelectedExercises() {
        if (!workoutId && !routineId) {
            console.warn('[ExercisesList] Missing valid workoutId; skipping addSelectedExercises.');
            return;
        }
        const ids = Object.keys(selected).filter((id) => selected[id]);
        if (ids.length === 0) return;

        if (isReplaceMode && replaceEntryId) {
            const replacementExerciseId = ids[0];

            await db.transaction('rw', [db.workout_log_entries, db.workout_sets, db.workouts], async () => {
                const entry = await db.workout_log_entries.get(replaceEntryId);
                if (!entry || entry.workout_id !== workoutId) return;

                const setDrafts = await getDefaultSetsFromPreviousWorkout(replacementExerciseId, workoutId);

                await db.workout_log_entries.update(replaceEntryId, {
                    exercise_id: replacementExerciseId,
                    synced: 0,
                });

                await db.workout_sets.where('workout_log_entry_id').equals(replaceEntryId).delete();

                for (const draft of setDrafts) {
                    await db.workout_sets.add({
                        id: generateId(),
                        workout_log_entry_id: replaceEntryId,
                        ...draft,
                    });
                }
            });

            pop();
            return;
        }

        if (routineId) {
            const existing = await db.workout_routine_entries.where('routine_id').equals(routineId).toArray();
            let sortOrder = (existing.map(e => e.sort_order).sort((a, b) => b - a)[0] || 0) + 1;

            await db.transaction('rw', [db.workout_routine_entries, db.workout_routine_sets], async () => {
                for (const id of ids) {
                    const routineEntryId = generateId();
                    await db.workout_routine_entries.add({
                        id: routineEntryId,
                        routine_id: routineId,
                        exercise_id: id,
                        sort_order: sortOrder++,
                        created_at: new Date(),
                        synced: 0
                    });

                    await db.workout_routine_sets.add({
                        id: generateId(),
                        routine_entry_id: routineEntryId,
                        set_number: 1,
                        weight: 0,
                        reps_min: 8,
                        reps_max: 10,
                        created_at: new Date(),
                        synced: 0,
                    });
                }
            });

            pop();
            return;
        }

        const existing = await db.workout_log_entries.where('workout_id').equals(workoutId).toArray();
        let sortOrder = (existing.map(e => e.sort_order).sort((a, b) => b - a)[0] || 0) + 1;

        await db.transaction('rw', [db.workout_log_entries, db.workout_sets, db.workouts], async () => {
            for (const id of ids) {
                const workoutLogEntryId = generateId();
                const setDrafts = await getDefaultSetsFromPreviousWorkout(id, workoutId);

                await db.workout_log_entries.add({
                    id: workoutLogEntryId,
                    workout_id: workoutId,
                    exercise_id: id,
                    sort_order: sortOrder++,
                    created_at: new Date(),
                    synced: 0
                });

                for (const draft of setDrafts) {
                    await db.workout_sets.add({
                        id: generateId(),
                        workout_log_entry_id: workoutLogEntryId,
                        ...draft,
                    });
                }
            }
        });

       // 2. Use pop to slide this page away to the right
    pop();
    }

    const handleResetLocalDb = async () => {
        if (!import.meta.env.DEV || isResettingLocalDb) return;

        const shouldReset = window.confirm('Reset local app data? This will clear IndexedDB and local storage, then reload the app.');
        if (!shouldReset) return;

        setIsResettingLocalDb(true);
        try {
            localStorage.clear();
            sessionStorage.clear();
            await db.delete();
            window.location.reload();
        } catch (error) {
            console.error('[ExercisesList] Failed to reset local DB', error);
            setIsResettingLocalDb(false);
        }
    };

    return (
        <div className="pb-24 pt-4 px-4 max-w-md mx-auto bg-background min-h-screen">
            {/* Header */}
            <header className="flex items-center justify-between mb-6">
                <h1 className="text-text-main font-bold text-lg">{isReplaceMode ? 'Replace Exercise' : 'Add Exercises'}</h1>
                <button
                    onClick={() => push(
                        routineId
                            ? `/workouts/exercises/new?routineId=${encodeURIComponent(routineId)}`
                            : workoutId
                            ? `/workouts/exercises/new?workoutId=${encodeURIComponent(workoutId)}${replaceEntryId ? `&replaceEntryId=${encodeURIComponent(replaceEntryId)}` : ''}`
                            : '/workouts/exercises/new'
                    )}
                    className="text-brand p-2 bg-brand/10 rounded-full hover:bg-brand/20 transition-colors"
                >
                    <CreateIcon size={22} weight="bold" />
                </button>
            </header>

            {import.meta.env.DEV ? (
                <div className="mb-4">
                    <button
                        onClick={handleResetLocalDb}
                        disabled={isResettingLocalDb}
                        className="text-xs font-semibold text-red-600 underline disabled:opacity-60"
                    >
                        {isResettingLocalDb ? 'Resetting local data...' : 'Reset local DB (tmp)'}
                    </button>
                </div>
            ) : null}

            {/* Search Bar */}
            <div className="relative mb-6">
                <SearchIcon
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                    size={20}
                />
                <input
                    type="text"
                    placeholder="Search exercises..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-card border border-border-subtle rounded-xl text-text-main focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all"
                />
            </div>

            {/* Filters */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div>
                    <label className="block text-xs font-bold text-text-muted uppercase mb-1 ml-1">Muscle Group</label>
                    <select
                        value={selectedMuscleGroup}
                        onChange={(e) => setSelectedMuscleGroup(e.target.value)}
                        className="w-full p-3 bg-card border border-border-subtle rounded-xl text-text-main focus:ring-2 focus:ring-brand outline-none appearance-none cursor-pointer"
                    >
                        <option value="All">All</option>
                        {MUSCLE_GROUPS.map((group) => (
                            <option key={group} value={group}>{group}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-bold text-text-muted uppercase mb-1 ml-1">Equipment</label>
                    <select
                        value={selectedEquipment}
                        onChange={(e) => setSelectedEquipment(e.target.value)}
                        className="w-full p-3 bg-card border border-border-subtle rounded-xl text-text-main focus:ring-2 focus:ring-brand outline-none appearance-none cursor-pointer"
                    >
                        <option value="All">All</option>
                        {EQUIPMENT_TYPES.map((equipment) => (
                            <option key={equipment} value={equipment}>{equipment}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Exercise List */}
            <div className="space-y-3">
                {filteredExercises.map((exercise) => (
                    (() => {
                        const fallbackMedia = mediaFallbackByExerciseId[exercise.id];
                        const thumbnailPath =
                            exercise.thumbnail_path ||
                            fallbackMedia?.thumbnailPath ||
                            DEFAULT_EXERCISE_THUMBNAIL_PATH;

                        return (
                    <div
                        key={exercise.id}
                        onClick={() => toggleSelect(exercise.id)}
                        className={`bg-card p-4 rounded-xl shadow-sm transition-all flex items-center justify-between cursor-pointer border-l-4 ${selected[exercise.id]
                            ? 'border-brand bg-brand/5' // Added a subtle background tint for better feedback
                            : 'border-transparent'
                            }`}
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            {thumbnailPath ? (
                                <div className="h-14 w-14 rounded-lg overflow-hidden border border-border-subtle bg-surface shrink-0">
                                    <img
                                        src={toWorkoutMediaUrl(thumbnailPath)}
                                        alt={exercise.name}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                    />
                                </div>
                            ) : null}
                            <div className="min-w-0">
                            <div className="font-bold text-lg text-text-main">{exercise.name}</div>
                            <div className="text-xs text-text-muted mt-1 uppercase tracking-wider font-semibold">
                                {exercise.muscle_group} • {exercise.equipment}
                            </div>
                            </div>
                        </div>
                        {/* Checkbox icon removed */}
                    </div>
                        );
                    })()
                ))}

                {filteredExercises.length === 0 && (
                    <div className="text-center py-12 text-text-muted">
                        <p>No exercises found.</p>
                        <p className="text-xs">Try adjusting search/filters or create one.</p>
                    </div>
                )}
            </div>

            {/* Persistent Bottom Button */}
            {selectedCount > 0 && (
                <div className="fixed bottom-20 left-4 right-4 max-w-md mx-auto animate-in slide-in-from-bottom-4 duration-300">
                    <button
                        className="w-full bg-brand text-white py-4 rounded-2xl font-bold shadow-xl flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
                        onClick={addSelectedExercises}
                    >
                        {isReplaceMode
                            ? 'Replace Exercise'
                            : `Add ${selectedCount} Exercise${selectedCount > 1 ? 's' : ''}`}
                    </button>
                </div>
            )}
        </div>
    );
}
