import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
// import { 
//   Plus, Check, Trash, MoreVertical, Settings, Timer, ChevronDown 
// } from 'lucide-react';
import { 
  PlusIcon as Plus, 
  CheckIcon as Check, 
  TrashIcon as Trash, 
  DotsThreeVerticalIcon as MoreVertical, 
  GearSixIcon as Settings, 
  TimerIcon as Timer, 
  CaretDownIcon as ChevronDown 
} from "@phosphor-icons/react";
import { db, type Workout, type WorkoutExerciseDef, type WorkoutLogEntry, type WorkoutSet } from '../../../lib/db';
import { generateId } from '../../../lib';
import { 
  getMetricConfig, getPreviousWorkoutSets, formatSet, METRIC_TYPES 
} from '../../../lib/workouts';





const StatItem = ({ label, value, border }: { label: string, value: string | number, border?: boolean }) => (
  <div className={`text-center ${border ? 'border-l border-border-subtle pl-4' : ''}`}>
    <span className="block text-text-primary text-sm font-bold font-mono">{value}</span>
    {label}
  </div>
);


  interface RestTimer {
  seconds: number;
  total: number;
}


const WorkoutSessionComponent = ({
}) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const workoutId = id === 'new' ? null : id;





// --- Missing Functions ---

  /**
   * Cancels the current workout. 
   * Deletes the workout, its log entries, and all associated sets.
   */
  const cancelWorkout = async () => {
    if (!workoutId) return;

    const confirmDiscard = window.confirm(
      "Are you sure you want to discard this workout? All progress will be lost."
    );

    if (confirmDiscard) {
      try {
        await db.transaction('rw', [db.workouts, db.workout_log_entries, db.workout_sets], async () => {
          // 1. Find all log entries associated with this workout
          const entryIds = (await db.workout_log_entries
            .where('workout_id')
            .equals(workoutId)
            .toArray()).map(e => e.id);

          // 2. Delete all sets associated with those entries
          await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).delete();

          // 3. Delete the log entries
          await db.workout_log_entries.where('workout_id').equals(workoutId).delete();

          // 4. Delete the workout itself
          await db.workouts.delete(workoutId);
        });

        // 5. Navigate away
        navigate('/workouts', { replace: true });
      } catch (error) {
        console.error("Failed to discard workout:", error);
        alert("Failed to discard workout.");
      }
    }
  };

  /**
   * Adjusts the current rest timer by adding or subtracting seconds.
   */
  const adjustRestTimer = (adjustmentSeconds: number) => {
    if (!activeRestTimer) return;

    setActiveRestTimer(prev => {
      if (!prev) return null;

      // Calculate new remaining time
      const newSeconds = Math.max(0, prev.seconds + adjustmentSeconds);
      
      // Calculate new end time based on the current moment + new remaining seconds
      const newEndTime = Date.now() + (newSeconds * 1000);
      
      // Update total if we increased the time beyond the original total
      const newTotal = adjustmentSeconds > 0 ? Math.max(prev.total, newSeconds) : prev.total;

      return {
        ...prev,
        seconds: newSeconds,
        endTime: newEndTime,
        total: newTotal
      };
    });
  };

  /**
   * Skips the rest timer immediately.
   */
  const skipRestTimer = () => {
    // Simply nullify the state; the useEffect cleanup handles the interval disposal
    setActiveRestTimer(null);
    
    // Optional: Stop vibration if skip is pressed during alert
    if ('vibrate' in navigator) navigator.vibrate(0);
  };






  // --- UI State ---
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const [activeRestTimer, setActiveRestTimer] = useState<{ 
    exerciseId: string, seconds: number, total: number, endTime: number 
  } | null>(null);
  const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);
  const [restPreferences, setRestPreferences] = useState<Record<string, number>>({});

  // --- Database Queries ---
  const workout = useLiveQuery(() => workoutId ? db.workouts.get(workoutId) : undefined, [workoutId]);
  
  const definitions = useLiveQuery(async () => {
    const defs = await db.workout_exercises_def.toArray();
    return defs.reduce((acc: any, d: { id: any; }) => ({ ...acc, [d.id]: d }), {} as Record<string, WorkoutExerciseDef>);
  }, []);

  const exercises = useLiveQuery(() => 
    workoutId ? db.workout_log_entries.where('workout_id').equals(workoutId).sortBy('sort_order') : [],
    [workoutId]
  );

  const sets = useLiveQuery(async () => {
    if (!exercises?.length) return {};
    const entryIds = exercises.map((e: { id: any; }) => e.id);
    const allSets = await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).toArray();
    
    const mapped = exercises.reduce((acc: any, e: { id: any; }) => ({ ...acc, [e.id]: [] }), {} as Record<string, WorkoutSet[]>);
    allSets.forEach((s: { workout_log_entry_id: string | number; }) => mapped[s.workout_log_entry_id]?.push(s));
    Object.keys(mapped).forEach(k => mapped[k].sort((a: { set_number: number; }, b: { set_number: number; }) => a.set_number - b.set_number));
    return mapped;
  }, [exercises]);

  // --- Initial Setup & New Workout Logic ---
  useEffect(() => {
    if (id === 'new') {
      const createWorkout = async () => {
        const newId = generateId();
        await db.workouts.add({
          id: newId,
          name: 'New Workout',
          start_time: new Date().toISOString(),
          synced: 0,
          user_id: ''
        } as Workout);
        navigate(`/workouts/${newId}`, { replace: true });
      };
      createWorkout();
    }
    
    // Load local storage prefs
    const stored = localStorage.getItem('rest_timer_preferences');
    if (stored) setRestPreferences(JSON.parse(stored));
  }, [id, navigate]);

  // --- Duration Timer ---
  useEffect(() => {
    if (!workout?.start_time || workout.end_time) return;

    const interval = setInterval(() => {
      const start = new Date(workout.start_time).getTime();
      const diff = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsedTime(h > 0 
        ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [workout]);

  // --- Computed Stats ---
  const totalStats = useMemo(() => {
    let vol = 0;
    let count = 0;
    Object.values(sets || {}).flat().forEach((s: unknown) => {
      const set = s as WorkoutSet;
      if (set.completed) {
        vol += (set.weight || 0) * (set.reps || 0);
        count++;
      }
    });
    return { volume: vol, sets: count };
  }, [sets]);

  // --- Actions ---
  const handleToggleSet = async (setId: string, completed: boolean, entryId: string, defId: string) => {
    const newStatus = !completed;
    await db.workout_sets.update(setId, { completed: newStatus, synced: 0 });
    
    if (newStatus) {
      const restTime = restPreferences[defId] || 60;
      startRestTimer(entryId, restTime);
    }
  };

  const startRestTimer = (exerciseId: string, seconds: number) => {
    const endTime = Date.now() + seconds * 1000;
    setActiveRestTimer({ exerciseId, seconds, total: seconds, endTime });
    
    // PWA Notification logic (simplified)
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Rest Timer Started', { body: `${seconds}s remaining` });
    }
  };

  // Rest Timer countdown effect
  useEffect(() => {
    if (!activeRestTimer) return;
    
    const interval = setInterval(() => {
      const remaining = Math.ceil((activeRestTimer.endTime - Date.now()) / 1000);
      if (remaining <= 0) {
        setActiveRestTimer(null);
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
        clearInterval(interval);
      } else {
        setActiveRestTimer(prev => prev ? { ...prev, seconds: remaining } : null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeRestTimer?.endTime]);

  return (
    <div className="pb-32 pt-4 px-4 max-w-md mx-auto min-h-screen bg-background">
      {/* Sticky Header */}
      <header className="mb-6 sticky top-0 bg-background z-20 py-2 border-b border-border-subtle -mx-4 px-4">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-xl font-bold truncate">{workout?.name || 'Workout'}</h1>
          <button 
            onClick={() => navigate('/workouts')}
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

      {/* Exercise List */}
      <div className="space-y-6">
        {exercises?.map((exercise: { exercise_id: string; id: string }) => {
          const def = definitions?.[exercise.exercise_id];
          const config = getMetricConfig(def?.metric_type);
          const currentSets = sets?.[exercise.id] || [];

          return (
            <div key={exercise.id} className="bg-card rounded-2xl p-4 shadow-sm border border-border-subtle">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-brand-dark">{def?.name}</h3>
                  <p className="text-xs text-text-muted">{def?.muscle_group} • {METRIC_TYPES[(def?.metric_type || 'weight_reps') as keyof typeof METRIC_TYPES]}</p>
                </div>
                <button onClick={() => setExpandedMenuId(prev => prev === exercise.id ? null : exercise.id)}>
                  <MoreVertical size={20} className="text-text-muted" />
                </button>
              </div>

              {/* Set Table */}
              <div className="space-y-2">
                {currentSets.map((set: { id: string; set_number: string | number | bigint | boolean | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | React.ReactPortal | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | null | undefined> | null | undefined; weight: string | number | readonly string[] | undefined; reps: string | number | readonly string[] | undefined; completed: any; }) => (
                  <div key={set.id} className="grid grid-cols-12 gap-2 items-center">
                    <span className="col-span-1 text-center text-text-muted font-bold">{set.set_number}</span>
                    <div className="col-span-9 grid grid-cols-2 gap-2">
                      <input 
                        type="number" 
                        defaultValue={set.weight}
                        className="bg-surface p-2 rounded text-center font-bold"
                        onChange={(e) => db.workout_sets.update(set.id, { weight: Number(e.target.value) })}
                      />
                      <input 
                        type="number" 
                        defaultValue={set.reps}
                        className="bg-surface p-2 rounded text-center font-bold"
                        onChange={(e) => db.workout_sets.update(set.id, { reps: Number(e.target.value) })}
                      />
                    </div>
                    <button 
                      onClick={() => handleToggleSet(set.id, set.completed, exercise.id, exercise.exercise_id)}
                      className={`col-span-2 h-10 rounded-lg flex items-center justify-center ${set.completed ? 'bg-green-500 text-white' : 'bg-surface'}`}
                    >
                      <Check size={18} />
                    </button>
                  </div>
                ))}
              </div>

              <button 
                onClick={async () => {
                  const lastSet = currentSets[currentSets.length - 1];
                  await db.workout_sets.add({
                    id: generateId(),
                    workout_log_entry_id: exercise.id,
                    set_number: currentSets.length + 1,
                    weight: lastSet?.weight || 0,
                    reps: lastSet?.reps || 0,
                    completed: false,
                    created_at: new Date(),
                    synced: 0
                  } as WorkoutSet);
                }}
                className="w-full mt-4 py-2 bg-brand/5 text-brand font-bold rounded-xl flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Add Set
              </button>
            </div>
          );
        })}
      </div>
      <div className="relative">
      <div className="pt-2">
        {/* In Hash Routing, we use a standard 'a' tag or 'Link' from react-router-dom */}
        <a
          href={`#/workouts/exercises?workoutId=${workoutId}`}
          className="group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border-subtle p-6 text-center transition-colors hover:border-brand hover:bg-brand/5"
        >
          <div className="rounded-full bg-surface-secondary p-3 transition-colors group-hover:bg-brand group-hover:text-white mb-2 text-text-muted">
            <Plus size={24} />
          </div>
          <span className="font-bold text-text-primary">Add Exercise</span>
          <span className="text-xs text-text-muted">Search or create new</span>
        </a>
      </div>
      </div>

      <button
        onClick={cancelWorkout}
        className="w-full py-4 text-red-500 text-sm font-medium mt-8 hover:bg-surface-secondary rounded-xl transition-colors"
      >
        Discard Workout
      </button>

      {/* Conditional Rendering (Replaces Svelte {#if}) */}
      {activeRestTimer && (
        <div className="fixed bottom-[calc(3.2rem+env(safe-area-inset-bottom)+1rem)] left-4 right-4 bg-page text-text-main shadow-2xl z-50 flex flex-col items-stretch animate-in slide-in-from-bottom rounded-2xl overflow-hidden">
          
          {/* Progress Bar */}
          <div className="h-1.5 w-full bg-border-subtle absolute top-0 left-0 right-0 z-0">
            <div
              className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
              style={{
                width: `${Math.min((activeRestTimer.seconds / activeRestTimer.total) * 100, 100)}%`,
              }}
            ></div>
          </div>

          <div className="flex items-center justify-between p-4 pt-6 relative z-10 w-full">
            <div className="flex flex-col">
              <span className="text-xs uppercase font-bold text-text-muted">
                Resting
              </span>
              <span className="text-3xl font-mono font-bold tabular-nums">
                {Math.floor(activeRestTimer.seconds / 60)}:
                {Math.floor(activeRestTimer.seconds % 60)
                  .toString()
                  .padStart(2, '0')}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => adjustRestTimer(-15)}
                className="p-2 bg-surface hover:bg-surface-secondary text-text-main rounded-lg font-bold text-sm border border-border-subtle"
              >
                -15
              </button>
              <button
                onClick={() => adjustRestTimer(15)}
                className="p-2 bg-surface hover:bg-surface-secondary text-text-main rounded-lg font-bold text-sm border border-border-subtle"
              >
                +15
              </button>
              <button
                onClick={skipRestTimer}
                className="px-4 py-2 bg-red-500 text-white font-bold rounded-lg ml-2 hover:bg-red-600 shadow-sm"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default WorkoutSessionComponent;

