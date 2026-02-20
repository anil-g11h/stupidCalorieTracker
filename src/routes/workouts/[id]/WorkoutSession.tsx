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
import { useStackNavigation } from '../../../lib/useStackNavigation';
import { useWorkoutSession } from './useWorkoutSession';








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
      className={`col-span-2 h-10 rounded-lg flex items-center justify-center transition-colors ${
        set.completed ? 'bg-green-500 text-white' : 'bg-surface'
      }`}
    >
      <Check size={18} />
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



const WorkoutSessionComponent = () => {
  const { id } = useParams();
  const workoutId: string | null = id === 'new' ? null : (id || null);

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
    finishWorkout, handleToggleSet, barRef
  } = useWorkoutSession(workoutId);

  return (
    <div className="pb-32 pt-4 px-4 max-w-md mx-auto min-h-screen bg-background">
      {/* Sticky Header */}
      <header className="mb-6 sticky top-0 bg-background z-20 py-2 border-b border-border-subtle -mx-4 px-4">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-xl font-bold truncate">{workout?.name || 'Workout'}</h1>
          <button
            onClick={finishWorkout}
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
        {exercises?.map((exercise) => {
          const def = definitions?.[exercise.exercise_id];
          const currentSets = sets?.[exercise.id] || [];

          return (
            <div key={exercise.id} className="bg-card rounded-2xl p-4 shadow-sm border border-border-subtle">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-brand-dark">{def?.name}</h3>
                  <p className="text-xs text-text-muted">
                    {def?.muscle_group} • {METRIC_TYPES[(def?.metric_type || 'weight_reps') as keyof typeof METRIC_TYPES]}
                  </p>
                </div>
                <button onClick={() => setExpandedMenuId(prev => prev === exercise.id ? null : exercise.id)}>
                  <MoreVertical size={20} className="text-text-muted" />
                </button>
              </div>

              {/* Set Table */}
              <div className="space-y-2">
                {currentSets.map((set: WorkoutSet) => (
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
                      onClick={() => handleToggleSet(set.id, set.completed ?? false, exercise.id, exercise.exercise_id)}
                      className={`col-span-2 h-10 rounded-lg flex items-center justify-center transition-colors ${
                        set.completed ? 'bg-green-500 text-white' : 'bg-surface'
                      }`}
                    >
                      <Check size={18} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleAddSet(exercise.id)}
                className="w-full mt-4 py-2 bg-brand/5 text-brand font-bold rounded-xl flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Add Set
              </button>
            </div>
          );
        })}
      </div>

      {/* Add Exercise Button with View Transition */}
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

