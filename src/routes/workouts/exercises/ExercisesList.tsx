import React, { useState, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  PlusIcon as PlusIcon, 
  CaretLeftIcon as CaretLeftIcon, 
  MagnifyingGlassIcon as SearchIcon,
  CheckIcon as CheckIcon,
  PlusCircleIcon as CreateIcon
} from '@phosphor-icons/react';
import { db, type WorkoutExerciseDef } from '../../../lib/db';
import { generateId } from '../../../lib';
import { METRIC_TYPES } from '../../../lib/workouts';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Other'];
const EQUIPMENT_TYPES = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'None'];

export default function ExerciseSelector() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workoutId = searchParams.get('workoutId');

  // --- UI State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // --- Data Fetching ---
  const allExercises = useLiveQuery(async () => {
    const data = await db.workout_exercises_def.toArray();
    // if (data.length === 0 && !searchTerm) {
    //   await seedDefaults();
    //   return [];
    // }
    return data;
  }, []);

  // --- Filtering & Sorting ---
  const filteredExercises = useMemo(() => {
    if (!allExercises) return [];
    
    const lower = searchTerm.toLowerCase();
    return allExercises
      .filter(e => 
        e.name.toLowerCase().includes(lower) || 
        (e.muscle_group && e.muscle_group.toLowerCase().includes(lower))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allExercises, searchTerm]);

  // --- Handlers ---
  const toggleSelect = (id: string) => {
    setSelected(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  async function addSelectedExercises() {
    if (!workoutId) return;
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (ids.length === 0) return;

    const existing = await db.workout_log_entries.where('workout_id').equals(workoutId).toArray();
    let sortOrder = (existing.map(e => e.sort_order).sort((a, b) => b - a)[0] || 0) + 1;

    await db.transaction('rw', db.workout_log_entries, async () => {
      for (const id of ids) {
        await db.workout_log_entries.add({
          id: generateId(),
          workout_id: workoutId,
          exercise_id: id,
          sort_order: sortOrder++,
          created_at: new Date(),
          synced: 0
        });
      }
    });

    navigate(`/workouts/${workoutId}`);
  }

  return (
    <div className="pb-24 pt-4 px-4 max-w-md mx-auto bg-background min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <button 
          className="text-brand font-bold text-sm flex items-center gap-1 hover:opacity-70 transition-opacity" 
          onClick={() => navigate(`/workouts/${workoutId}`)}
        >
          <CaretLeftIcon weight="bold" />
          Cancel
        </button>
        <h1 className="text-text-main font-bold text-lg">Add Exercises</h1>
        <Link 
          to="/workouts/exercises/new"
          className="text-brand p-2 bg-brand/10 rounded-full hover:bg-brand/20 transition-colors"
        >
          <CreateIcon size={22} weight="bold" />
        </Link>
      </header>

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

      {/* Exercise List */}
      <div className="space-y-3">
        {filteredExercises.map((exercise) => (
          <div
            key={exercise.id}
            onClick={() => toggleSelect(exercise.id)}
            className={`bg-card p-4 rounded-xl shadow-sm border-2 transition-all flex items-center justify-between cursor-pointer ${
              selected[exercise.id] ? 'border-brand' : 'border-transparent'
            }`}
          >
            <div>
              <div className="font-bold text-lg text-text-main">{exercise.name}</div>
              <div className="text-xs text-text-muted mt-1 uppercase tracking-wider font-semibold">
                {exercise.muscle_group} • {exercise.equipment}
              </div>
            </div>
            {selected[exercise.id] && (
              <div className="bg-brand text-white rounded-full p-1 animate-in zoom-in-50 duration-200">
                <CheckIcon size={16} weight="bold" />
              </div>
            )}
          </div>
        ))}

        {filteredExercises.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            <p>No exercises found.</p>
            <p className="text-xs">Try searching for something else or create one.</p>
          </div>
        )}
      </div>

      {/* Persistent Bottom Button */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-4 right-4 max-w-md mx-auto animate-in slide-in-from-bottom-4 duration-300">
          <button 
            className="w-full bg-brand text-white py-4 rounded-2xl font-bold shadow-xl flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
            onClick={addSelectedExercises}
          >
            Add {selectedCount} Exercise{selectedCount > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Seeds default exercises if the database is empty.
 */
async function seedDefaults() {
  const defaults = [
    { name: 'Bench Press', muscle_group: 'Chest', equipment: 'Barbell', metric_type: 'weight_reps' },
    { name: 'Squat', muscle_group: 'Legs', equipment: 'Barbell', metric_type: 'weight_reps' },
    { name: 'Deadlift', muscle_group: 'Back', equipment: 'Barbell', metric_type: 'weight_reps' },
    { name: 'Overhead Press', muscle_group: 'Shoulders', equipment: 'Barbell', metric_type: 'weight_reps' },
    { name: 'Pull Up', muscle_group: 'Back', equipment: 'Bodyweight', metric_type: 'weighted_bodyweight' },
    { name: 'Running', muscle_group: 'Cardio', equipment: 'None', metric_type: 'distance_duration' }
  ];

  await db.transaction('rw', db.workout_exercises_def, async () => {
    for (const d of defaults) {
      await db.workout_exercises_def.add({
        id: generateId(),
        user_id: null,
        name: d.name,
        muscle_group: d.muscle_group,
        equipment: d.equipment,
        metric_type: d.metric_type as any,
        created_at: new Date(),
        synced: 0
      });
    }
  });
}