import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
// import { 
//   Plus, Check, Trash, MoreVertical, Settings, Timer, ChevronDown 
// } from 'lucide-react';
import {
  PlusIcon as Plus,
  CheckIcon as Check,
  CopyIcon as Copy,
  FloppyDiskIcon as Save,
  TrashIcon as Trash,
  DotsThreeVerticalIcon as MoreVertical,
  PencilSimpleIcon as Edit,
  TimerIcon as Timer,
  CaretDownIcon as ChevronDown,
  BarbellIcon as Dumbbell
} from "@phosphor-icons/react";
import { db, type Workout, type WorkoutExerciseDef, type WorkoutLogEntry, type WorkoutSet } from '../../../lib/db';
import { generateId } from '../../../lib';
import {
  getMetricConfig, getPreviousWorkoutSets, formatSet, METRIC_TYPES
} from '../../../lib/workouts';
import { useStackNavigation } from '../../../lib/useStackNavigation';
import { useWorkoutSession } from './useWorkoutSession';
import { DurationScrollerInput, getMetricColumns } from '../components/WorkoutSetComponents';
import { syncWorkoutExerciseThumbnailPaths } from '../../../lib/workoutMedia';








const StatItem = ({ label, value, border }: { label: string, value: string | number, border?: boolean }) => (
  <div className={`text-center ${border ? 'border-l border-border-subtle pl-4' : ''}`}>
    <span className="block text-text-primary text-sm font-bold font-mono">{value}</span>
    {label}
  </div>
);

const toWorkoutMediaUrl = (path?: string | null) => {
  if (!path) return '';
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\/+/, '')}`;
};

const DEFAULT_EXERCISE_THUMBNAIL_PATH = 'workouts/images/exercise-default-thumb.svg';

const formatCompletedSetMetricValue = (
  set: WorkoutSet,
  field: 'weight' | 'reps' | 'distance' | 'duration_seconds' | null,
  unit: string
) => {
  if (!field) return null;

  const rawValue = Number((set as any)[field] ?? 0);
  if (field === 'duration_seconds') {
    const safeSeconds = Math.max(0, Math.floor(rawValue));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    if (mins <= 0) return `${secs}s`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  if (unit === 'kg') return `${rawValue}kg`;
  if (unit === 'km') return `${rawValue}km`;
  if (unit === 'reps') return `${rawValue} reps`;
  return `${rawValue}`;
};

const formatCompletedSetByMetric = (
  set: WorkoutSet,
  firstField: 'weight' | 'reps' | 'distance' | 'duration_seconds' | null,
  firstUnit: string,
  secondField: 'weight' | 'reps' | 'distance' | 'duration_seconds' | null,
  secondUnit: string
) => {
  const firstValue = formatCompletedSetMetricValue(set, firstField, firstUnit);
  const secondValue = formatCompletedSetMetricValue(set, secondField, secondUnit);

  if (firstValue && secondValue) return `${firstValue} x ${secondValue}`;
  return firstValue || secondValue || '-';
};

type WorkoutMediaEntry = {
  sourceId: string;
  videoPath: string;
  thumbnailPath: string | null;
};

type WorkoutMediaMap = {
  media?: WorkoutMediaEntry[];
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





interface RestTimer {
  seconds: number;
  total: number;
}


const WorkoutHeader = ({ workout, elapsedTime, totalStats, onFinish, onBack }: { 
  workout?: Workout; 
  elapsedTime: string; 
  totalStats: { volume: number; sets: number }; 
  onFinish: () => void;
  onBack?: () => void;
}) => (
  <header className="mb-6 sticky top-0 bg-background z-20 py-2 border-b border-border-subtle -mx-4 px-4">
    <div className="flex justify-between items-center mb-2">
      <h1 className="text-xl font-bold truncate">{workout?.name || 'Workout'}</h1>
      <button
        onClick={onFinish}
        className="bg-brand text-white px-5 py-2 rounded-xl text-sm font-bold shadow-md"
      >
        Finish
      </button>
    </div>

    <div className="flex justify-between text-xs font-semibold text-text-muted uppercase">
      <StatItem label="Duration" value={elapsedTime} />
      <StatItem label="Volume" value={`${totalStats.volume} kg`} border />
      <StatItem label="Sets" value={totalStats.sets} border />
    </div>
  </header>
);




const ExerciseCard = ({ definition, sets, onToggleSet, onAddSet, onMenuClick }: { 
  exercise: WorkoutLogEntry;
  definition?: WorkoutExerciseDef;
  sets: WorkoutSet[];
  onToggleSet: (setId: string, completed: boolean, entryId: string, defId: string) => Promise<void>;
  onAddSet: () => void;
  onMenuClick: () => void;
}) => {
  return (
    <div className="bg-card rounded-2xl p-4 shadow-sm border border-border-subtle">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-bold text-lg text-brand-dark">{definition?.name}</h3>
          <p className="text-xs text-text-muted">
            {definition?.muscle_group} • {METRIC_TYPES[definition?.metric_type as keyof typeof METRIC_TYPES || 'weight_reps']}
          </p>
        </div>
        <button onClick={onMenuClick}>
          <MoreVertical size={20} className="text-text-muted" />
        </button>
      </div>

      <div className="space-y-2">
        {sets.map((set) => (
          <SetRow 
            key={set.id} 
            set={set} 
            onToggle={() => onToggleSet(set.id, set.completed ?? false, set.id, definition?.id || '')} 
          />
        ))}
      </div>

      <button
        onClick={onAddSet}
        className="w-full mt-4 py-2 bg-brand/5 text-brand font-bold rounded-xl flex items-center justify-center gap-2"
      >
        <Plus size={16} /> Add Set
      </button>
    </div>
  );
};


const SetRow = ({ set, onToggle }: { set: WorkoutSet; onToggle: () => void }) => (
  <div className="grid grid-cols-12 gap-2 items-center">
    <span className="col-span-1 text-center text-text-muted font-bold">{set.set_number}</span>
    <div className="col-span-9 grid grid-cols-2 gap-2">
      <input
        type="number"
        defaultValue={set.weight}
        className="bg-surface p-2 rounded text-center font-bold outline-none focus:ring-1 focus:ring-brand"
        onChange={(e) => db.workout_sets.update(set.id, { weight: Number(e.target.value) })}
      />
      <input
        type="number"
        defaultValue={set.reps}
        className="bg-surface p-2 rounded text-center font-bold outline-none focus:ring-1 focus:ring-brand"
        onChange={(e) => db.workout_sets.update(set.id, { reps: Number(e.target.value) })}
      />
    </div>
    <button
      onClick={onToggle}
      className={`col-span-2 h-8 w-8 mx-auto rounded-md flex items-center justify-center transition-colors ${
        set.completed ? 'bg-green-500 text-white' : 'bg-surface border border-border-subtle text-text-muted'
      }`}
    >
      <Check size={12} />
    </button>
  </div>
);



interface RestTimerProps {
  timer: any;
  onAdjust: (secs: number) => void;
  onSkip: () => void;
  barRef: React.RefObject<HTMLDivElement | null>; // Add this
}

const RestTimerOverlay = ({ timer, onAdjust, onSkip, barRef }: RestTimerProps) => {
  return (
    <div className="fixed bottom-[calc(3.2rem+env(safe-area-inset-bottom)+1rem)] left-4 right-4 bg-page text-text-main shadow-2xl z-50 flex flex-col items-stretch rounded-2xl overflow-hidden animate-in slide-in-from-bottom duration-300">
      
      {/* Progress Bar Container */}
      <div className="h-1.5 w-full bg-border-subtle relative overflow-hidden">
        <div
          ref={barRef} // The hook will move this at 60fps
          className="h-full bg-blue-500 timer-bar-fill"
          style={{ width: '100%' }} 
        />
      </div>

      <div className="flex items-center justify-between p-4 pt-6 relative z-10 w-full">
        <div className="flex flex-col">
          <span className="text-xs uppercase font-bold text-text-muted">Resting</span>
          <span className="text-3xl font-mono font-bold tabular-nums">
            {Math.floor(timer.seconds / 60)}:
            {(timer.seconds % 60).toString().padStart(2, '0')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => onAdjust(-15)} className="p-2 bg-surface rounded-lg active:scale-90 transition-transform font-bold border border-border-subtle">-15</button>
          <button onClick={() => onAdjust(15)} className="p-2 bg-surface rounded-lg active:scale-90 transition-transform font-bold border border-border-subtle">+15</button>
          <button onClick={onSkip} className="px-4 py-2 bg-red-500 text-white font-bold rounded-lg ml-2 shadow-sm active:scale-90 transition-transform">Skip</button>
        </div>
      </div>
    </div>
  );
};

const CompletedWorkoutView = ({
  workout,
  elapsedTime,
  exercises,
  definitions,
  sets,
  mediaFallbackByExerciseId,
}: {
  workout?: Workout;
  elapsedTime: string;
  exercises?: WorkoutLogEntry[];
  definitions?: Record<string, WorkoutExerciseDef>;
  sets?: Record<string, WorkoutSet[]>;
  mediaFallbackByExerciseId?: Record<string, { videoPath?: string; thumbnailPath?: string }>;
}) => (
  <div className="space-y-4">
    {workout?.notes?.trim() ? (
      <div className="rounded-xl border border-border-subtle bg-card p-4">
        <p className="text-xs font-semibold uppercase text-text-muted mb-2">How it went</p>
        <p className="text-sm text-text-main whitespace-pre-wrap">{workout.notes}</p>
      </div>
    ) : null}

    <div className="space-y-3">
      {exercises?.map((exercise) => {
        const definition = definitions?.[exercise.exercise_id];
        const fallbackMedia = mediaFallbackByExerciseId?.[exercise.exercise_id];
        const metricColumns = getMetricColumns(definition?.metric_type);
        const isDurationOnlyMetric = metricColumns.first.field === 'duration_seconds' && metricColumns.second.field === null;
        const headerThumbnailUrl = toWorkoutMediaUrl(
          definition?.thumbnail_path ||
          fallbackMedia?.thumbnailPath ||
          DEFAULT_EXERCISE_THUMBNAIL_PATH
        );
        const currentSets = sets?.[exercise.id] || [];
        if (currentSets.length === 0) return null;

        return (
          <div key={exercise.id} className="bg-card rounded-2xl p-4 shadow-sm border border-border-subtle">
            <div className="flex items-start gap-3 mb-4">
              <Link
                to={`/workouts/exercises/${encodeURIComponent(exercise.exercise_id)}`}
                className="flex items-center gap-3 min-w-0 rounded-lg -m-1 p-1"
              >
                <div className="h-12 w-12 rounded-lg overflow-hidden bg-surface flex-shrink-0">
                  <img
                    src={headerThumbnailUrl}
                    alt={definition?.name || 'Workout exercise'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0">
                  <span className="font-bold text-lg text-brand truncate block hover:underline">
                    {definition?.name || 'Exercise'}
                  </span>
                </div>
              </Link>
            </div>

            <div className="mb-2 grid grid-cols-12 gap-2 items-center text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <span className="col-span-2 text-center">Set</span>
              {isDurationOnlyMetric ? (
                <span className="col-span-10 text-center">{metricColumns.first.label}</span>
              ) : (
                <>
                  <span className="col-span-5 text-center">{metricColumns.first.label}</span>
                  <span className="col-span-5 text-center">{metricColumns.second.label}</span>
                </>
              )}
            </div>

            <div className="space-y-2">
              {currentSets.map((set) => (
                <div key={set.id} className="grid grid-cols-12 gap-2 items-center rounded-lg bg-transparent px-2 py-2 text-sm">
                  <span className="col-span-2 text-center text-text-muted font-bold">{set.set_number}</span>
                  <span className="col-span-10 text-text-main font-medium">
                    {formatCompletedSetByMetric(
                      set,
                      metricColumns.first.field,
                      metricColumns.first.unit,
                      metricColumns.second.field,
                      metricColumns.second.unit
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);



const WorkoutSessionComponent = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const workoutId: string | null = id === 'new' ? null : (id || null);
  const { push, pop } = useStackNavigation();
  const [isEditingCompleted, setIsEditingCompleted] = useState(searchParams.get('edit') === '1');

  useEffect(() => {
    setIsEditingCompleted(searchParams.get('edit') === '1');
  }, [searchParams]);

  // Destructuring everything from our custom hook
  const {
    workout,
    exercises,
    definitions,
    sets,
    totalStats,
    elapsedTime,
    activeRestTimer,
    expandedMenuId,
    setExpandedMenuId,
    handleAddSet,
    cancelWorkout,
    adjustRestTimer,
    skipRestTimer,
    navigateToAddExercises,
    handleRemoveExercise,
    handleReorderExercise,
    navigateToReplaceExercise,
    requestFinishWorkout,
    saveFinishedWorkout,
    copyWorkout,
    deleteWorkout,
    handleToggleSet,
    restPreferences,
    setExerciseRestPreference,
    barRef
  } = useWorkoutSession(workoutId, isEditingCompleted);

  const [showFinishScreen, setShowFinishScreen] = useState(false);
  const [finishTitle, setFinishTitle] = useState('Workout');
  const [finishDurationMinutes, setFinishDurationMinutes] = useState(1);
  const [finishDescription, setFinishDescription] = useState('');
  const [isSavingFinish, setIsSavingFinish] = useState(false);
  const [showWorkoutActions, setShowWorkoutActions] = useState(false);
  const [isCopyingWorkout, setIsCopyingWorkout] = useState(false);
  const [isDeletingWorkout, setIsDeletingWorkout] = useState(false);
  const [editingRestExerciseId, setEditingRestExerciseId] = useState<string | null>(null);
  const [mediaFallbackByExerciseId, setMediaFallbackByExerciseId] = useState<Record<string, { videoPath?: string; thumbnailPath?: string }>>({});

  const previousSetsByExercise = useLiveQuery(async () => {
    if (!exercises?.length || !workout?.start_time) return {};
    const exerciseIds = Array.from(new Set(exercises.map((exercise) => exercise.exercise_id)));
    return getPreviousWorkoutSets(exerciseIds, workout.start_time);
  }, [exercises, workout?.start_time]);

  const isFinished = Boolean(workout?.end_time);
  const showCompletedReadonly = isFinished && !isEditingCompleted;
  const canEditWorkout = !showCompletedReadonly;

  const completedWorkoutOrdinal = useLiveQuery(async () => {
    if (!showCompletedReadonly || !workout?.id) return null;

    const finishedWorkouts = (await db.workouts.toArray())
      .filter((item) => item.end_time)
      .sort((a, b) => new Date(a.end_time as any).getTime() - new Date(b.end_time as any).getTime());

    const index = finishedWorkouts.findIndex((item) => item.id === workout.id);
    return index >= 0 ? index + 1 : null;
  }, [showCompletedReadonly, workout?.id, workout?.end_time]);

  const restTimerOptions = useMemo(() => {
    const base = [0, 5, 10, 15];
    for (let value = 20; value <= 120; value += 5) base.push(value);
    for (let value = 135; value <= 300; value += 15) base.push(value);
    return base;
  }, []);

  const formatRestTimer = (seconds: number) => {
    if (seconds <= 0) return 'OFF';
    if (seconds < 60) return `${seconds}s`;
    if (seconds % 60 === 0) return `${seconds / 60}min`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const formatPreviousSetValue = (set?: WorkoutSet) => {
    if (!set) return '-';
    const previousWeight = Number(set.weight ?? 0);
    const previousReps = Number(set.reps ?? 0);
    return `${previousWeight}kg x ${previousReps}`;
  };

  const formatDurationValue = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    if (mins <= 0) return `${secs}s`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toOrdinal = (value: number) => {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    switch (value % 10) {
      case 1:
        return `${value}st`;
      case 2:
        return `${value}nd`;
      case 3:
        return `${value}rd`;
      default:
        return `${value}th`;
    }
  };

  const formatPreviousSetValueByMetric = (
    set: WorkoutSet | undefined,
    firstField: 'weight' | 'reps' | 'distance' | 'duration_seconds' | null,
    firstUnit: string,
    secondField: 'weight' | 'reps' | 'distance' | 'duration_seconds' | null,
    secondUnit: string
  ) => {
    if (!set) return '-';

    const renderValue = (
      field: 'weight' | 'reps' | 'distance' | 'duration_seconds' | null,
      unit: string
    ) => {
      if (!field) return null;
      const raw = Number((set as any)[field] ?? 0);
      if (field === 'duration_seconds') return formatDurationValue(raw);
      if (unit === 'kg') return `${raw}kg`;
      if (unit === 'km') return `${raw}km`;
      return `${raw}`;
    };

    const firstValue = renderValue(firstField, firstUnit);
    const secondValue = renderValue(secondField, secondUnit);

    if (firstValue && secondValue) return `${firstValue} x ${secondValue}`;
    return firstValue || secondValue || '-';
  };

  const getSetFieldPlaceholder = (set: WorkoutSet, field: 'weight' | 'reps' | 'distance' | 'duration_seconds' | null) => {
    if (field !== 'reps') return undefined;
    if (set.reps_min == null && set.reps_max == null) return undefined;

    const min = set.reps_min ?? set.reps_max;
    const max = set.reps_max ?? set.reps_min;
    if (min == null || max == null) return undefined;
    return `${min}-${max}`;
  };

  const transitionFinishScreen = (direction: 'forward' | 'backward', update: () => void) => {
    if (!document.startViewTransition) {
      update();
      return;
    }

    document.documentElement.classList.add(`transition-${direction}`);
    const transition = document.startViewTransition(() => {
      update();
    });

    transition.finished.finally(() => {
      document.documentElement.classList.remove(`transition-${direction}`);
    });
  };

  const getCurrentDurationMinutes = () => {
    if (!workout?.start_time) return 0;
    const startMs = new Date(workout.start_time).getTime();
    const endMs = workout.end_time ? new Date(workout.end_time).getTime() : Date.now();
    return Math.max(0, Math.round((endMs - startMs) / 60000));
  };

  const durationOptions = Array.from({ length: 300 }, (_, i) => i);

  const handleOpenFinishScreen = async () => {
    const canFinish = await requestFinishWorkout();
    if (!canFinish) return;

    setFinishTitle('');
    setFinishDurationMinutes(getCurrentDurationMinutes());
    setFinishDescription(workout?.notes || '');
    transitionFinishScreen('forward', () => setShowFinishScreen(true));
  };

  const handleSaveFinishedWorkout = async () => {
    setIsSavingFinish(true);
    try {
      await saveFinishedWorkout({
        title: finishTitle,
        durationMinutes: finishDurationMinutes,
        description: finishDescription,
        stayOnPage: isEditingCompleted,
      });

      if (isEditingCompleted) {
        setIsEditingCompleted(false);
        setShowFinishScreen(false);
      }
    } finally {
      setIsSavingFinish(false);
    }
  };

  const handleEditWorkout = () => {
    setShowWorkoutActions(false);
    setIsEditingCompleted(true);
  };

  const handleCopyWorkout = async () => {
    setIsCopyingWorkout(true);
    try {
      await copyWorkout();
    } finally {
      setIsCopyingWorkout(false);
      setShowWorkoutActions(false);
    }
  };

  const handleSaveAsRoutine = () => {
    if (!workoutId) return;
    if (!exercises?.length) {
      alert('No exercises to save as routine.');
      return;
    }

    setShowWorkoutActions(false);
    push(`/workouts/routines/new?fromWorkoutId=${encodeURIComponent(workoutId)}`);
  };

  const handleDeleteWorkout = async () => {
    setIsDeletingWorkout(true);
    try {
      await deleteWorkout();
    } finally {
      setIsDeletingWorkout(false);
      setShowWorkoutActions(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const resolveFallbackMedia = async () => {
      const defs = Object.values(definitions || {}) as WorkoutExerciseDef[];
      if (!defs.length) {
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

        for (const def of defs) {
          if (def.video_path || def.thumbnail_path) continue;

          let matched: WorkoutMediaEntry | undefined;
          if (def.source_id) {
            matched = bySourceId.get(def.source_id);
          }

          if (!matched) {
            const normalizedExerciseName = normalizeName(def.name || '');
            matched = byNormalizedName.find((item) =>
              item.normalizedName === normalizedExerciseName ||
              item.normalizedName.includes(normalizedExerciseName) ||
              normalizedExerciseName.includes(item.normalizedName)
            )?.entry;
          }

          if (matched) {
            next[def.id] = {
              videoPath: matched.videoPath,
              thumbnailPath: matched.thumbnailPath || undefined,
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
  }, [definitions]);

  return (
    <div className="pb-32 pt-4 px-4 max-w-md mx-auto min-h-screen bg-background">
      {/* Sticky Header */}
      <header className="mb-6 sticky top-0 bg-background z-20 py-2 border-b border-border-subtle -mx-4 px-4">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {(showFinishScreen || showCompletedReadonly) && (
              <button
                onClick={() => {
                  if (showFinishScreen) {
                    transitionFinishScreen('backward', () => {
                      setShowFinishScreen(false);
                      if (isEditingCompleted) setIsEditingCompleted(false);
                    });
                    return;
                  }
                  pop();
                }}
                className="h-9 w-9 rounded-lg border border-border-subtle bg-surface text-text-main flex items-center justify-center"
                aria-label="Back"
              >
                <ChevronDown size={18} className="rotate-90" />
              </button>
            )}
            <h1 className="text-xl font-bold truncate">
              {showFinishScreen ? 'Finish Workout' : showCompletedReadonly ? 'Workout Detail' : (workout?.name || 'Workout')}
            </h1>
          </div>
          {showFinishScreen ? (
            <button
              onClick={handleSaveFinishedWorkout}
              disabled={isSavingFinish}
              className="bg-brand text-white px-5 py-2 rounded-xl text-sm font-bold shadow-md disabled:opacity-60"
            >
              {isSavingFinish ? 'Saving...' : 'Save'}
            </button>
          ) : isFinished ? (
            showCompletedReadonly ? (
              <div className="relative">
                <button
                  onClick={() => setShowWorkoutActions((prev) => !prev)}
                  className="h-10 w-10 rounded-xl border border-border-subtle bg-surface text-text-main flex items-center justify-center"
                  aria-label="Workout actions"
                >
                  <MoreVertical size={18} />
                </button>

                {showWorkoutActions && (
                  <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border-subtle bg-card shadow-lg z-30 overflow-hidden">
                    <button
                      onClick={handleEditWorkout}
                      className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface inline-flex items-center gap-2"
                    >
                      <Edit size={16} />
                      Edit Workout
                    </button>
                    <button
                      onClick={handleCopyWorkout}
                      disabled={isCopyingWorkout}
                      className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface inline-flex items-center gap-2"
                    >
                      <Copy size={16} />
                      {isCopyingWorkout ? 'Copying...' : 'Copy Workout'}
                    </button>
                    <button
                      onClick={handleSaveAsRoutine}
                      className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface inline-flex items-center gap-2"
                    >
                      <Save size={16} />
                      Save as Routine
                    </button>
                    <button
                      onClick={handleDeleteWorkout}
                      disabled={isDeletingWorkout}
                      className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-500 hover:bg-surface disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      <Trash size={16} />
                      {isDeletingWorkout ? 'Deleting...' : 'Delete Workout'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleOpenFinishScreen}
                className="bg-brand text-white px-5 py-2 rounded-xl text-sm font-bold shadow-md"
              >
                Finish
              </button>
            )
          ) : (
            <button
              onClick={handleOpenFinishScreen}
              className="bg-brand text-white px-5 py-2 rounded-xl text-sm font-bold shadow-md"
            >
              Finish
            </button>
          )}
        </div>

        {!showFinishScreen && !showCompletedReadonly && (
          <div className="flex justify-between text-xs font-semibold text-text-muted uppercase">
            <StatItem label="Duration" value={elapsedTime} />
            <StatItem label="Volume" value={`${totalStats.volume} kg`} border />
            <StatItem label="Sets" value={totalStats.sets} border />
          </div>
        )}
      </header>

      {canEditWorkout && showFinishScreen ? (
        <section className="rounded-2xl border border-border-subtle bg-card p-4 space-y-4">
          <div>
            <input
              value={finishTitle}
              onChange={(e) => setFinishTitle(e.target.value)}
              placeholder={workout?.name?.trim() || 'Workout'}
              className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
            />
          </div>

          <div className="rounded-xl border border-border-subtle bg-surface p-3">
            <p className="text-xs font-semibold text-text-muted uppercase mb-3">Duration</p>
            <select
              value={finishDurationMinutes}
              onChange={(e) => setFinishDurationMinutes(Number(e.target.value))}
              className="w-full rounded-lg border border-border-subtle bg-card px-3 py-2 text-base font-bold text-text-main tabular-nums"
            >
              {durationOptions.map((totalMinutes) => {
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const label = hours > 0
                  ? `${hours}h ${minutes.toString().padStart(2, '0')}min`
                  : `${minutes} min`;

                return (
                  <option key={totalMinutes} value={totalMinutes}>{label}</option>
                );
              })}
            </select>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold uppercase text-text-muted">
              <div className="rounded-lg border border-border-subtle bg-card px-3 py-2 text-center">
                <span className="block text-text-primary text-sm font-bold font-mono">{totalStats.volume} kg</span>
                Volume
              </div>
              <div className="rounded-lg border border-border-subtle bg-card px-3 py-2 text-center">
                <span className="block text-text-primary text-sm font-bold font-mono">{totalStats.sets}</span>
                Sets
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase mb-1">How did your workout go?</label>
            <textarea
              value={finishDescription}
              onChange={(e) => setFinishDescription(e.target.value)}
              rows={4}
              placeholder="Add notes about energy, form, PRs, and anything you want to remember."
              className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main resize-none"
            />
          </div>

          <div className="rounded-xl border border-dashed border-border-subtle bg-surface px-3 py-3">
            <p className="text-sm font-semibold text-text-main">Photos & videos</p>
            <p className="text-xs text-text-muted mt-1">Coming soon: add media from camera or gallery.</p>
          </div>

        </section>
      ) : showCompletedReadonly ? (
        <>
          <section className="rounded-2xl border border-border-subtle bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-text-main truncate">{workout?.name || 'Workout'}</h2>
                {completedWorkoutOrdinal ? (
                  <p className="text-xs font-semibold text-text-muted mt-0.5">
                    {toOrdinal(completedWorkoutOrdinal)} workout
                  </p>
                ) : null}
                <p className="text-xs text-text-muted">
                  {workout?.end_time ? new Date(workout.end_time).toLocaleString() : ''}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-border-subtle bg-surface px-2 py-2">
                <p className="text-[11px] font-semibold uppercase text-text-muted">Time</p>
                <p className="text-sm font-bold text-text-main">{elapsedTime}</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface px-2 py-2">
                <p className="text-[11px] font-semibold uppercase text-text-muted">Volume</p>
                <p className="text-sm font-bold text-text-main">{totalStats.volume} kg</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface px-2 py-2">
                <p className="text-[11px] font-semibold uppercase text-text-muted">Sets</p>
                <p className="text-sm font-bold text-text-main">{totalStats.sets}</p>
              </div>
            </div>
          </section>

          <CompletedWorkoutView
            workout={workout}
            elapsedTime={elapsedTime}
            exercises={exercises}
            definitions={definitions}
            sets={sets}
            mediaFallbackByExerciseId={mediaFallbackByExerciseId}
          />
        </>
      ) : (
        <>
          {/* Exercise List */}
          <div className="space-y-6">
            {exercises?.map((exercise, exerciseIndex) => {
              const def = definitions?.[exercise.exercise_id];
              const fallbackMedia = mediaFallbackByExerciseId[exercise.exercise_id];
              const currentSets = sets?.[exercise.id] || [];
              const previousSets = previousSetsByExercise?.[exercise.exercise_id]?.sets || [];
              const metricColumns = getMetricColumns(def?.metric_type);
              const firstMetricField = metricColumns.first.field;
              const secondMetricField = metricColumns.second.field;
              const restSeconds = restPreferences?.[exercise.exercise_id] ?? 0;
              const isEditingRestTimer = editingRestExerciseId === exercise.id;
              const isMenuOpen = expandedMenuId === exercise.id;
              const isFirstExercise = exerciseIndex === 0;
              const isLastExercise = exerciseIndex === (exercises.length - 1);
              const isDurationOnlyMetric = metricColumns.first.field === 'duration_seconds' && metricColumns.second.field === null;
              const thumbnailUrl = toWorkoutMediaUrl(
                def?.thumbnail_path || fallbackMedia?.thumbnailPath || DEFAULT_EXERCISE_THUMBNAIL_PATH
              );

              return (
                <div key={exercise.id} className="bg-card rounded-2xl p-4 shadow-sm border border-border-subtle">
                  <div className="flex justify-between items-start mb-4">
                    <div className="min-w-0">
                      <Link
                        to={`/workouts/exercises/${encodeURIComponent(exercise.exercise_id)}`}
                        className="flex items-center gap-3 min-w-0 rounded-lg -m-1 p-1"
                      >
                        <div className="h-12 w-12 rounded-lg overflow-hidden bg-surface flex-shrink-0">
                          <img
                            src={thumbnailUrl}
                            alt={def?.name || 'Workout exercise'}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="min-w-0">
                          <span className="font-bold text-lg text-brand truncate block hover:underline">
                            {def?.name || 'Exercise'}
                          </span>
                        </div>
                      </Link>
                      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {isEditingRestTimer ? (
                          <div className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-brand">
                            <Timer size={12} />
                            <select
                              autoFocus
                              value={restSeconds}
                              onBlur={() => setEditingRestExerciseId(null)}
                              onChange={(e) => {
                                const nextValue = Number(e.target.value);
                                void setExerciseRestPreference(exercise.exercise_id, nextValue);
                                setEditingRestExerciseId(null);
                              }}
                              className="bg-transparent text-[11px] font-semibold tracking-wide text-brand outline-none"
                            >
                              {restTimerOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option === 0 ? 'Rest: OFF' : `Rest: ${formatRestTimer(option)}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingRestExerciseId(exercise.id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-brand"
                          >
                            <Timer size={12} />
                            <span className="text-brand">Rest: {formatRestTimer(restSeconds)}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {canEditWorkout && (
                      <div className="relative">
                        <button onClick={() => setExpandedMenuId(prev => prev === exercise.id ? null : exercise.id)}>
                          <MoreVertical size={20} className="text-text-muted" />
                        </button>

                        {isMenuOpen && (
                          <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border-subtle bg-card shadow-lg z-30 overflow-hidden">
                            <button
                              onClick={() => navigateToReplaceExercise(exercise.id)}
                              className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface"
                            >
                              Replace Exercise
                            </button>
                            <button
                              onClick={() => handleReorderExercise(exercise.id, 'up')}
                              disabled={isFirstExercise}
                              className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Move Up
                            </button>
                            <button
                              onClick={() => handleReorderExercise(exercise.id, 'down')}
                              disabled={isLastExercise}
                              className="w-full px-3 py-2.5 text-left text-sm font-medium text-text-main hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Move Down
                            </button>
                            <button
                              onClick={() => handleRemoveExercise(exercise.id)}
                              className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-500 hover:bg-surface"
                            >
                              Remove Exercise
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Set Table */}
                  <div className="mb-2 grid grid-cols-12 gap-2 items-center text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    <span className="col-span-1 text-center">Set</span>
                    <span className="col-span-4">Previous</span>
                    {isDurationOnlyMetric ? (
                      <span className="col-span-5 text-center">{metricColumns.first.label}</span>
                    ) : (
                      <>
                        <span className="col-span-2 text-center flex items-center justify-center gap-1">
                          {metricColumns.first.field === 'weight' ? <Dumbbell size={12} /> : null}
                          {metricColumns.first.label}
                        </span>
                        <span className="col-span-3 text-center">{metricColumns.second.label}</span>
                      </>
                    )}
                    <span className="col-span-2 text-center flex items-center justify-center"><Check size={12} /></span>
                  </div>

                  <div className="space-y-2">
                    {currentSets.map((set: WorkoutSet, setIndex: number) => (
                      <div
                        key={set.id}
                        className={`grid grid-cols-12 gap-2 items-center rounded-lg px-1 py-1 transition-colors ${
                          set.completed ? 'bg-green-500/10' : 'bg-transparent'
                        }`}
                      >
                        <span className="col-span-1 text-center text-text-muted font-bold">{set.set_number}</span>
                        <div className="col-span-4 rounded px-2 py-2 text-[11px] font-semibold text-text-muted truncate">
                          {formatPreviousSetValueByMetric(
                            previousSets[setIndex],
                            metricColumns.first.field,
                            metricColumns.first.unit,
                            metricColumns.second.field,
                            metricColumns.second.unit
                          )}
                        </div>
                        {isDurationOnlyMetric ? (
                          <div className="col-span-5">
                            <DurationScrollerInput
                              valueSeconds={Number((set as any).duration_seconds ?? 0)}
                              onChange={(nextSeconds) => db.workout_sets.update(set.id, { duration_seconds: nextSeconds })}
                            />
                          </div>
                        ) : (
                          <>
                            <div className="col-span-2">
                              {firstMetricField ? (
                                firstMetricField === 'duration_seconds' ? (
                                  <DurationScrollerInput
                                    valueSeconds={Number((set as any)[firstMetricField] ?? 0)}
                                    onChange={(nextSeconds) => db.workout_sets.update(set.id, { [firstMetricField]: nextSeconds })}
                                  />
                                ) : (
                                  <input
                                    type="number"
                                    defaultValue={
                                      firstMetricField === 'reps'
                                        ? ((set as any)[firstMetricField] ?? '')
                                        : Number((set as any)[firstMetricField] ?? 0)
                                    }
                                    placeholder={getSetFieldPlaceholder(set, firstMetricField)}
                                    className="w-full bg-transparent p-2 rounded text-center font-bold"
                                    onChange={(e) => db.workout_sets.update(set.id, { [firstMetricField]: Number(e.target.value) })}
                                  />
                                )
                              ) : (
                                <div className="h-10 flex items-center justify-center text-text-muted">-</div>
                              )}
                            </div>
                            <div className="col-span-3">
                              {secondMetricField ? (
                                secondMetricField === 'duration_seconds' ? (
                                  <DurationScrollerInput
                                    valueSeconds={Number((set as any)[secondMetricField] ?? 0)}
                                    onChange={(nextSeconds) => db.workout_sets.update(set.id, { [secondMetricField]: nextSeconds })}
                                  />
                                ) : (
                                  <input
                                    type="number"
                                    defaultValue={
                                      secondMetricField === 'reps'
                                        ? ((set as any)[secondMetricField] ?? '')
                                        : Number((set as any)[secondMetricField] ?? 0)
                                    }
                                    placeholder={getSetFieldPlaceholder(set, secondMetricField)}
                                    className="w-full bg-transparent p-2 rounded text-center font-bold"
                                    onChange={(e) => db.workout_sets.update(set.id, { [secondMetricField]: Number(e.target.value) })}
                                  />
                                )
                              ) : (
                                <div className="h-10 flex items-center justify-center text-text-muted">-</div>
                              )}
                            </div>
                          </>
                        )}
                        <button
                          onClick={() => handleToggleSet(set.id, set.completed ?? false, exercise.id, exercise.exercise_id)}
                          className={`col-span-2 h-8 w-8 mx-auto rounded-md flex items-center justify-center transition-colors ${
                            set.completed ? 'bg-green-500 text-white' : 'bg-surface border border-border-subtle text-text-muted'
                          }`}
                        >
                          <Check size={12} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {canEditWorkout && (
                    <button
                      onClick={() => handleAddSet(exercise.id)}
                      className="w-full mt-4 py-2 bg-brand/5 text-brand font-bold rounded-xl flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> Add Set
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add Exercise Button with View Transition */}
          {canEditWorkout && (
            <>
              <div className="pt-6">
                <button
                  onClick={navigateToAddExercises}
                  className="group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border-subtle p-6 text-center transition-colors hover:border-brand hover:bg-brand/5 cursor-pointer"
                >
                  <div className="rounded-full bg-surface-secondary p-3 transition-colors group-hover:bg-brand group-hover:text-white mb-2 text-text-muted">
                    <Plus size={24} />
                  </div>
                  <span className="font-bold text-text-primary">Add Exercise</span>
                  <span className="text-xs text-text-muted">Search or create new</span>
                </button>
              </div>

              <button
                onClick={cancelWorkout}
                className="w-full py-4 text-red-500 text-sm font-medium mt-8 hover:bg-surface-secondary rounded-xl transition-colors"
              >
                Discard Workout
              </button>
            </>
          )}
        </>
      )}

      {/* Rest Timer Overlay */}
      {activeRestTimer && (
        <RestTimerOverlay 
            timer={activeRestTimer} 
            onAdjust={adjustRestTimer} 
            onSkip={skipRestTimer} 
            barRef={barRef}
        />
      )}
    </div>
  );
};



export default WorkoutSessionComponent;

