import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
// import { Plus, ChevronRight, Calendar } from 'lucide-react';
import { PlusIcon, CaretRightIcon, CalendarIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/db';

export default function WorkoutList() {
  // --- Data Fetching ---
  // Replaces the manual subscription and loadWorkouts() function
  const workouts = useLiveQuery(
    () => db.workouts.orderBy('start_time').reverse().toArray(),
    []
  );

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

  return (
    <div className="pb-24 pt-4 px-4 max-w-md mx-auto">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-text-main">Workouts</h1>
        <Link 
          to="/workouts/new" 
          className="bg-brand text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 hover:bg-brand-dark transition-colors shadow-sm"
        >
          <PlusIcon size={18} />
          Start Workout
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
            <Link 
              key={workout.id} 
              to={`/workouts/${workout.id}`} 
              className="block bg-card rounded-xl p-4 shadow-sm border border-border-subtle hover:border-brand-light transition-all active:scale-[0.98]"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg text-text-main">
                    {workout.name || 'Untitled Workout'}
                  </h3>
                  <div className="text-xs text-text-muted mt-1 flex gap-2">
                    <span>{formatDate(workout.start_time)}</span>
                    <span>•</span>
                    <span>{formatTime(workout.start_time)}</span>
                    {workout.end_time && (
                      <span>- {formatTime(workout.end_time)}</span>
                    )}
                  </div>
                </div>
                <CaretRightIcon size={20} className="text-text-muted" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}