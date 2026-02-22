import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
// import { Plus, ChevronRight, Calendar } from 'lucide-react';
import {
  CalendarIcon,
  DotsThreeVerticalIcon as MoreVertical,
  PencilSimpleIcon as Edit,
  CopyIcon as Copy,
  FloppyDiskIcon as Save,
  TrashIcon as Trash,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/db';
import { generateId } from '../../lib';
import { useStackNavigation } from '../../lib/useStackNavigation';

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

type WorkoutSummary = {
  exercises: number;
  sets: number;
  durationMinutes: number;
  previewExercise?: {
    name: string;
    sourceId?: string;
    thumbnailPath?: string;
    videoPath?: string;
  };
  exerciseLines: Array<{
    name: string;
    sets: number;
    sourceId?: string;
    thumbnailPath?: string;
    videoPath?: string;
  }>;
};

export default function WorkoutList() {
  const { push } = useStackNavigation();
  // --- Data Fetching ---
  // Replaces the manual subscription and loadWorkouts() function
  const workouts = useLiveQuery(
    async () => {
      const all = await db.workouts.orderBy('start_time').reverse().toArray();
      return all.filter((workout) => Boolean(workout.end_time));
    },
    []
  );

  const [mediaEntries, setMediaEntries] = useState<WorkoutMediaEntry[]>([]);
  const [openMenuWorkoutId, setOpenMenuWorkoutId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{ workoutId: string; action: 'copy' | 'save' | 'delete' } | null>(null);

  const isActionRunning = (workoutId: string, action: 'copy' | 'save' | 'delete') =>
    actionState?.workoutId === workoutId && actionState.action === action;

  useEffect(() => {
    let cancelled = false;

    const loadMediaMap = async () => {
      try {
        const response = await fetch(toWorkoutMediaUrl('workouts/media-map.json'), { cache: 'no-cache' });
        if (!response.ok) return;
        const mediaMap = (await response.json()) as WorkoutMediaMap;
        if (!cancelled) setMediaEntries(mediaMap.media || []);
      } catch {
        if (!cancelled) setMediaEntries([]);
      }
    };

    void loadMediaMap();
    return () => {
      cancelled = true;
    };
  }, []);

  const mediaLookup = useMemo(() => {
    const bySourceId = new Map(mediaEntries.map((entry) => [entry.sourceId, entry]));
    const byNormalizedName = mediaEntries.map((entry) => ({
      entry,
      normalizedName: mediaNameFromVideoPath(entry.videoPath),
    }));

    return { bySourceId, byNormalizedName };
  }, [mediaEntries]);

  const workoutSummaries = useLiveQuery(async () => {
    if (!workouts?.length) return {} as Record<string, WorkoutSummary>;

    const workoutIds = workouts.map((workout) => workout.id);
    const entries = await db.workout_log_entries.where('workout_id').anyOf(workoutIds).toArray();

    const entryToWorkoutId = new Map<string, string>();
    entries.forEach((entry) => entryToWorkoutId.set(entry.id, entry.workout_id));

    const exerciseIds = [...new Set(entries.map((entry) => entry.exercise_id))];
    const exerciseDefs = exerciseIds.length
      ? await db.workout_exercises_def.where('id').anyOf(exerciseIds).toArray()
      : [];
    const exerciseNameById = new Map(exerciseDefs.map((exerciseDef) => [exerciseDef.id, exerciseDef.name]));

    const entryIds = entries.map((entry) => entry.id);
    const sets = entryIds.length
      ? await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).toArray()
      : [];

    const setCountByEntryId = new Map<string, number>();
    sets.forEach((set) => {
      setCountByEntryId.set(set.workout_log_entry_id, (setCountByEntryId.get(set.workout_log_entry_id) || 0) + 1);
    });

    const summaries: Record<string, WorkoutSummary> = {};

    workouts.forEach((workout) => {
      const durationMs = workout.end_time
        ? new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()
        : 0;

      summaries[workout.id] = {
        exercises: 0,
        sets: 0,
        durationMinutes: Math.max(0, Math.round(durationMs / 60000)),
        exerciseLines: []
      };
    });

    const sortedEntries = [...entries].sort((a, b) => a.sort_order - b.sort_order);
    const firstEntryByWorkoutId = new Map<string, (typeof sortedEntries)[number]>();

    sortedEntries.forEach((entry) => {
      const summary = summaries[entry.workout_id];
      if (!summary) return;

      if (!firstEntryByWorkoutId.has(entry.workout_id)) {
        firstEntryByWorkoutId.set(entry.workout_id, entry);
      }

      summary.exercises += 1;
      const exerciseDef = exerciseDefs.find((item) => item.id === entry.exercise_id);
      summary.exerciseLines.push({
        name: exerciseNameById.get(entry.exercise_id) || 'Exercise',
        sets: setCountByEntryId.get(entry.id) || 0,
        sourceId: exerciseDef?.source_id,
        thumbnailPath: exerciseDef?.thumbnail_path,
        videoPath: exerciseDef?.video_path,
      });
    });

    firstEntryByWorkoutId.forEach((entry, workoutId) => {
      const summary = summaries[workoutId];
      if (!summary) return;

      const exerciseDef = exerciseDefs.find((item) => item.id === entry.exercise_id);
      if (!exerciseDef) return;

      summary.previewExercise = {
        name: exerciseDef.name || 'Exercise',
        sourceId: exerciseDef.source_id,
        thumbnailPath: exerciseDef.thumbnail_path,
        videoPath: exerciseDef.video_path,
      };
    });

    sets.forEach((set) => {
      const workoutId = entryToWorkoutId.get(set.workout_log_entry_id);
      if (workoutId && summaries[workoutId]) {
        summaries[workoutId].sets += 1;
      }
    });

    return summaries;
  }, [workouts]);

  // --- Helper Functions ---
  const formatDate = (iso: string) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short' 
    });
  };

  const formatTime = (iso: string) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatSummary = (workoutId: string) => {
    const summary = workoutSummaries?.[workoutId];
    if (!summary) return 'No exercises yet';

    const parts = [
      `${summary.exercises} ${summary.exercises === 1 ? 'exercise' : 'exercises'}`,
      `${summary.sets} ${summary.sets === 1 ? 'set' : 'sets'}`
    ];

    if (summary.durationMinutes > 0) {
      parts.push(`${summary.durationMinutes} min`);
    }

    return parts.join(' • ');
  };

  const handleCopyWorkout = async (workoutId: string) => {
    setActionState({ workoutId, action: 'copy' });
    try {
      const workout = await db.workouts.get(workoutId);
      if (!workout) return;

      const sourceEntries = await db.workout_log_entries
        .where('workout_id')
        .equals(workoutId)
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
    } finally {
      setActionState(null);
      setOpenMenuWorkoutId(null);
    }
  };

  const handleSaveAsRoutine = (workoutId: string) => {
    setOpenMenuWorkoutId(null);
    push(`/workouts/routines/new?fromWorkoutId=${encodeURIComponent(workoutId)}`);
  };

  const handleDeleteWorkout = async (workoutId: string) => {
    if (!window.confirm('Delete this workout? This cannot be undone.')) return;
    setActionState({ workoutId, action: 'delete' });

    try {
      await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
        const entryIds = (await db.workout_log_entries.where('workout_id').equals(workoutId).toArray()).map((entry) => entry.id);
        if (entryIds.length) {
          await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).delete();
        }
        await db.workout_log_entries.where('workout_id').equals(workoutId).delete();
        await db.workouts.delete(workoutId);
      });
    } catch (error) {
      console.error('Failed to delete workout:', error);
      alert('Error deleting workout.');
    } finally {
      setActionState(null);
      setOpenMenuWorkoutId(null);
    }
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-md mx-auto">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-text-main">Workouts</h1>
        <Link
          to="/workouts/start"
          className="h-10 w-10 rounded-full bg-brand text-white text-2xl font-semibold leading-none flex items-center justify-center hover:bg-brand-dark transition-colors shadow-sm"
          aria-label="Start workout options"
          title="Start workout options"
        >
          +
        </Link>
      </header>

      {/* Conditional Rendering */}
      {!workouts ? (
        // Loading state
        <div className="text-center py-12 text-text-muted">Loading workouts...</div>
      ) : workouts.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <div className="bg-surface-secondary w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <CalendarIcon size={32} />
          </div>
          <p className="font-medium">No workouts logged yet.</p>
          <p className="text-xs mt-1">Start tracking your progress!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workouts.map((workout) => (
            <div
              key={workout.id}
              className="relative bg-card rounded-2xl p-4 shadow-sm border border-border-subtle hover:border-brand-light transition-all"
            >
              <button
                onClick={() => setOpenMenuWorkoutId((current) => current === workout.id ? null : workout.id)}
                className="absolute top-3 right-3 h-8 w-8 rounded-lg border border-border-subtle bg-surface text-text-main flex items-center justify-center z-10"
                aria-label="Workout options"
              >
                <MoreVertical size={16} />
              </button>

              {openMenuWorkoutId === workout.id && (
                <div className="absolute right-3 top-12 w-44 rounded-xl border border-border-subtle bg-card shadow-lg z-20 overflow-hidden">
                  <button
                    onClick={() => {
                      setOpenMenuWorkoutId(null);
                      push(`/workouts/${workout.id}?edit=1`);
                    }}
                    className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface inline-flex items-center gap-2"
                  >
                    <Edit size={16} />
                    Edit Workout
                  </button>
                  <button
                    onClick={() => handleCopyWorkout(workout.id)}
                    disabled={isActionRunning(workout.id, 'copy')}
                    className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    <Copy size={16} />
                    {isActionRunning(workout.id, 'copy') ? 'Copying...' : 'Copy Workout'}
                  </button>
                  <button
                    onClick={() => handleSaveAsRoutine(workout.id)}
                    disabled={isActionRunning(workout.id, 'save')}
                    className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    <Save size={16} />
                    {isActionRunning(workout.id, 'save') ? 'Saving...' : 'Save as Routine'}
                  </button>
                  <button
                    onClick={() => handleDeleteWorkout(workout.id)}
                    disabled={isActionRunning(workout.id, 'delete')}
                    className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-500 hover:bg-surface inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    <Trash size={16} />
                    {isActionRunning(workout.id, 'delete') ? 'Deleting...' : 'Delete Workout'}
                  </button>
                </div>
              )}

              <Link to={`/workouts/${workout.id}`} className="block active:scale-[0.98] transition-transform">
              {(() => {
                const summary = workoutSummaries?.[workout.id];
                const lines = summary?.exerciseLines || [];
                const visibleLines = lines.slice(0, 3);
                const remainingCount = Math.max(0, lines.length - visibleLines.length);

                const preview = summary?.previewExercise;
                let previewThumbnailPath = preview?.thumbnailPath;
                let previewVideoPath = preview?.videoPath;

                if ((!previewThumbnailPath && !previewVideoPath) && preview?.name) {
                  let matched: WorkoutMediaEntry | undefined;

                  if (preview.sourceId) {
                    matched = mediaLookup.bySourceId.get(preview.sourceId);
                  }

                  if (!matched) {
                    const normalizedExerciseName = normalizeName(preview.name);
                    matched = mediaLookup.byNormalizedName.find((item) =>
                      item.normalizedName === normalizedExerciseName ||
                      item.normalizedName.includes(normalizedExerciseName) ||
                      normalizedExerciseName.includes(item.normalizedName)
                    )?.entry;
                  }

                  if (matched) {
                    previewThumbnailPath = matched.thumbnailPath || undefined;
                    previewVideoPath = matched.videoPath;
                  }
                }

                const thumbnailUrl = toWorkoutMediaUrl(previewThumbnailPath);
                const videoUrl = toWorkoutMediaUrl(previewVideoPath);

                return (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1 pr-10">
                        <h3 className="font-semibold text-lg text-text-main truncate">
                          {workout.name || 'Untitled Workout'}
                        </h3>
                        <div className="text-xs text-text-muted mt-1 flex gap-2 flex-wrap">
                          <span>{formatDate(workout.start_time)}</span>
                          <span>•</span>
                          <span>{formatTime(workout.start_time)}</span>
                          {workout.end_time && (
                            <span>- {formatTime(workout.end_time)}</span>
                          )}
                        </div>

                        <p className="text-xs text-text-muted mt-2">
                          {formatSummary(workout.id)}
                        </p>
                      </div>
                    </div>

                    {lines.length > 0 && (
                      <div className="mt-3 rounded-xl border border-border-subtle bg-surface p-3">
                        <div className="space-y-1.5">
                          {visibleLines.map((line, index) => (
                            (() => {
                              let lineThumbnailPath = line.thumbnailPath;
                              let lineVideoPath = line.videoPath;

                              if ((!lineThumbnailPath && !lineVideoPath) && line.name) {
                                let matched: WorkoutMediaEntry | undefined;

                                if (line.sourceId) {
                                  matched = mediaLookup.bySourceId.get(line.sourceId);
                                }

                                if (!matched) {
                                  const normalizedExerciseName = normalizeName(line.name);
                                  matched = mediaLookup.byNormalizedName.find((item) =>
                                    item.normalizedName === normalizedExerciseName ||
                                    item.normalizedName.includes(normalizedExerciseName) ||
                                    normalizedExerciseName.includes(item.normalizedName)
                                  )?.entry;
                                }

                                if (matched) {
                                  lineThumbnailPath = matched.thumbnailPath || undefined;
                                  lineVideoPath = matched.videoPath;
                                }
                              }

                              const lineThumbnailUrl = toWorkoutMediaUrl(lineThumbnailPath);
                              const lineVideoUrl = toWorkoutMediaUrl(lineVideoPath);

                              return (
                                <div key={`${line.name}-${index}`} className="flex items-center gap-2.5 min-w-0">
                                  {(lineThumbnailUrl || lineVideoUrl) ? (
                                    <div className="h-8 w-8 rounded-md overflow-hidden bg-card border border-border-subtle shrink-0">
                                      {lineThumbnailUrl ? (
                                        <img
                                          src={lineThumbnailUrl}
                                          alt={line.name || 'Exercise'}
                                          className="h-full w-full object-cover"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <video
                                          src={lineVideoUrl}
                                          className="h-full w-full object-cover"
                                          muted
                                          playsInline
                                          preload="metadata"
                                        />
                                      )}
                                    </div>
                                  ) : null}

                                  <p className="text-sm text-text-main truncate">
                                    <span className="font-semibold">{line.sets} set{line.sets === 1 ? '' : 's'}</span>{' '}
                                    {line.name}
                                  </p>
                                </div>
                              );
                            })()
                          ))}
                          {remainingCount > 0 && (
                            <p className="text-xs text-text-muted font-medium">
                              See {remainingCount} more exercise{remainingCount === 1 ? '' : 's'}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}