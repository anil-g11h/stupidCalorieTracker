// src/lib/db.ts
import Dexie, { type Table } from 'dexie';

let remoteSyncWriteDepth = 0;

export function isRemoteSyncWriteInProgress(): boolean {
  return remoteSyncWriteDepth > 0;
}

export async function withRemoteSyncWrite<T>(operation: () => Promise<T>): Promise<T> {
  remoteSyncWriteDepth += 1;
  try {
    return await operation();
  } finally {
    remoteSyncWriteDepth = Math.max(0, remoteSyncWriteDepth - 1);
  }
}

export interface Profile {
  id: string; // uuid from supabase auth
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  diet_tags?: string[];
  allergies?: string[];
  custom_allergies?: string[];
  goal_focus?: string | null;
  activity_level?: string | null;
  medical_constraints?: string[];
  meal_pattern?: string | null;
  updated_at?: Date;
  synced?: number;
}

export interface Food {
  id: string; // uuid
  user_id?: string | null; // null for public foods
  name: string;
  brand?: string;
  diet_tags?: string[];
  allergen_tags?: string[];
  ai_notes?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size?: number;
  serving_unit?: string;
  is_recipe: boolean; // if true, it's a composite food
  micros?: Record<string, number>;
  created_at?: Date;
  updated_at?: Date;
  synced?: number; // 1 = synced, 0 = pending
}

export interface FoodIngredient {
  id: string; // uuid
  parent_food_id: string; // The Recipe
  child_food_id: string; // The Ingredient
  quantity: number; // Amount of child food used
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface DailyLog {
  id: string; // uuid
  user_id: string;
  date: string; // YYYY-MM-DD
  meal_type: string; // 'breakfast', 'lunch', 'dinner', 'snack'
  food_id: string;
  amount_consumed: number; // Multiplier of serving size
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface Goal {
  id: string; // uuid
  user_id: string;
  start_date: string; // YYYY-MM-DD
  calories_target: number;
  protein_target: number;
  carbs_target: number;
  fat_target: number;
  sleep_target?: number; // hours
  water_target?: number; // ml
  weight_target?: number; // kg or lbs
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface BodyMetric {
  id: string; // uuid
  user_id: string;
  date: string; // YYYY-MM-DD
  type: string; // 'weight', 'waist', 'chest', etc.
  value: number;
  unit: string; // 'kg', 'cm', 'in', etc.
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface SyncQueue {
  id?: number; // Auto-increment
  table: string;
  action: 'create' | 'update' | 'delete';
  data: any;
  created_at: number;
  attempt_count?: number;
  last_attempt_at?: number;
  last_error?: string;
}

export type MealTargetMode = 'percent' | 'calories';

export interface MealSetting {
  id: string;
  name: string;
  time: string;
  targetMode: MealTargetMode;
  targetValue: number;
}

export interface ReminderSetting {
  enabled: boolean;
  time: string;
}

export interface UserSettings {
  id: string;
  user_id?: string | null;
  nutrition: {
    calorieBudget: number;
    proteinPercent: number;
    carbPercent: number;
    fatPercent: number;
    fiberGrams: number;
    proteinTargetGrams?: number;
    carbsTargetGrams?: number;
    fatTargetGrams?: number;
    sleepTarget?: number;
    waterTarget?: number;
    weightTarget?: number;
  };
  meals: MealSetting[];
  reminders: {
    food: ReminderSetting;
    water: ReminderSetting;
    workout: ReminderSetting;
    walk: ReminderSetting;
    weight: ReminderSetting;
    medicine: ReminderSetting;
  };
  updated_at: string;
  synced?: number;
}

export interface Activity {
  id: string; // uuid
  user_id?: string | null; // null for public activities
  name: string;
  category?: string; // 'Work', 'Rest', 'Leisure', 'Chore', 'Health', 'Other'
  target_duration_minutes?: number;
  target_type?: 'min' | 'max';
  calories_per_hour: number;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface ActivityLog {
  id: string; // uuid
  user_id: string;
  date: string; // YYYY-MM-DD
  activity_id: string;
  start_time: string; // ISO string
  end_time: string; // ISO string
  duration_minutes: number;
  calories_burned: number;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface WorkoutExerciseDef {
  id: string;
  user_id?: string | null;
  source_id?: string;
  name: string;
  muscle_group?: string;
  secondary_muscle_groups?: string[];
  equipment?: string;
  video_path?: string;
  thumbnail_path?: string;
  // 'weight_reps' | 'reps_only' | 'weighted_bodyweight' | 'duration' | 'duration_weight' | 'distance_duration' | 'distance_weight'
  metric_type?: string; 
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface Workout {
  id: string;
  user_id: string;
  name?: string;
  start_time: string;
  end_time?: string;
  notes?: string;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface WorkoutLogEntry {
  id: string;
  workout_id: string;
  exercise_id: string; // references WorkoutExerciseDef
  sort_order: number;
  notes?: string;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface WorkoutSet {
  id: string;
  workout_log_entry_id: string;
  set_number: number;
  weight?: number;
  reps?: number;
  reps_min?: number;
  reps_max?: number;
  distance?: number;
  duration_seconds?: number;
  rpe?: number;
  is_warmup?: boolean;
  completed?: boolean;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface WorkoutRoutine {
  id: string;
  user_id: string;
  name: string;
  notes?: string;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface WorkoutRoutineEntry {
  id: string;
  routine_id: string;
  exercise_id: string;
  sort_order: number;
  notes?: string;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface WorkoutRoutineSet {
  id: string;
  routine_entry_id: string;
  set_number: number;
  weight?: number;
  reps_min?: number;
  reps_max?: number;
  distance?: number;
  duration_seconds?: number;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export interface WorkoutRestPreference {
  id: string;
  user_id: string;
  exercise_id: string;
  rest_seconds: number;
  created_at?: Date;
  updated_at?: Date;
  synced?: number;
}

export class MyDatabase extends Dexie {
  profiles!: Table<Profile>;
  foods!: Table<Food>;
  food_ingredients!: Table<FoodIngredient>;
  logs!: Table<DailyLog>;
  goals!: Table<Goal>;
  metrics!: Table<BodyMetric>;
  settings!: Table<UserSettings>;
  activities!: Table<Activity>;
  activity_logs!: Table<ActivityLog>;
  sync_queue!: Table<SyncQueue>;
  // Workouts
  workout_exercises_def!: Table<WorkoutExerciseDef>;
  workouts!: Table<Workout>;
  workout_log_entries!: Table<WorkoutLogEntry>;
  workout_sets!: Table<WorkoutSet>;
  workout_rest_preferences!: Table<WorkoutRestPreference>;
  workout_routines!: Table<WorkoutRoutine>;
  workout_routine_entries!: Table<WorkoutRoutineEntry>;
  workout_routine_sets!: Table<WorkoutRoutineSet>;

  constructor() {
    super('StupidCaloriesTrackerDB');
    this.version(4).stores({
      profiles: 'id',
      foods: 'id, user_id, name, is_recipe, synced',
      food_ingredients: 'id, parent_food_id, child_food_id, synced',
      logs: 'id, user_id, date, meal_type, synced',
      goals: 'id, user_id, start_date, synced',
      metrics: 'id, user_id, date, type, synced',
      settings: 'id, user_id, synced',
      activities: 'id, user_id, name, synced',
      activity_logs: 'id, user_id, date, activity_id, synced',
      sync_queue: '++id, table, action, created_at',
      // Workouts
      workout_exercises_def: 'id, user_id, name, muscle_group, metric_type, synced',
      workouts: 'id, user_id, start_time, synced',
      workout_log_entries: 'id, workout_id, exercise_id, synced',
      workout_sets: 'id, workout_log_entry_id, synced',
      workout_rest_preferences: 'id, user_id, exercise_id, [user_id+exercise_id], updated_at, synced'
    });

    this.version(5).stores({
      profiles: 'id',
      foods: 'id, user_id, name, is_recipe, synced',
      food_ingredients: 'id, parent_food_id, child_food_id, synced',
      logs: 'id, user_id, date, meal_type, synced',
      goals: 'id, user_id, start_date, synced',
      metrics: 'id, user_id, date, type, synced',
      settings: 'id, user_id, synced',
      activities: 'id, user_id, name, synced',
      activity_logs: 'id, user_id, date, activity_id, synced',
      sync_queue: '++id, table, action, created_at',
      workout_exercises_def: 'id, user_id, name, muscle_group, metric_type, synced',
      workouts: 'id, user_id, start_time, synced',
      workout_log_entries: 'id, workout_id, exercise_id, synced',
      workout_sets: 'id, workout_log_entry_id, synced',
      workout_rest_preferences: 'id, user_id, exercise_id, [user_id+exercise_id], updated_at, synced',
      workout_routines: 'id, user_id, name, updated_at, synced',
      workout_routine_entries: 'id, routine_id, exercise_id, sort_order, synced',
      workout_routine_sets: 'id, routine_entry_id, synced'
    });
    
    // Hooks for sync
    const tablesToSync = [
        'profiles', 'foods', 'food_ingredients', 'logs', 'goals', 'metrics', 
      'settings',
        'activities', 'activity_logs',
        'workout_exercises_def', 'workouts', 'workout_log_entries', 'workout_sets', 'workout_rest_preferences',
        'workout_routines', 'workout_routine_entries', 'workout_routine_sets'
    ] as const;

    tablesToSync.forEach((tableName) => {
      // @ts-ignore
      this.table(tableName).hook('creating', (primKey, obj, transaction) => {
        if (isRemoteSyncWriteInProgress()) return;
        if (obj.synced === 1) return; // synced from server
        const nowIso = new Date().toISOString();
        if (!obj.created_at) {
          obj.created_at = nowIso;
        }
        if (!obj.updated_at) {
          obj.updated_at = obj.created_at ?? nowIso;
        }
        obj.synced = 0; 
        
        setTimeout(() => {
          this.sync_queue.add({
            table: tableName,
            action: 'create',
            data: { ...obj, id: primKey },
            created_at: Date.now()
          }).catch(err => console.error(`[DB] Failed to add to sync_queue for ${tableName}:`, err));
        }, 0);
      });

      // @ts-ignore
      this.table(tableName).hook('updating', (mods, primKey, obj, transaction) => {
        if (isRemoteSyncWriteInProgress()) return;
        if (tableName === 'workout_exercises_def' && !obj?.user_id) return;
        if ((mods as any).synced === 1) return;
        const nowIso = new Date().toISOString();
        const updatedObj = { ...obj, ...mods, updated_at: nowIso, synced: 0 };
        
        setTimeout(() => {
          this.sync_queue.add({
            table: tableName,
            action: 'update',
            data: updatedObj,
            created_at: Date.now()
          }).catch(err => console.error(`[DB] Failed to add to sync_queue for ${tableName}:`, err));
        }, 0);

        return { synced: 0, updated_at: nowIso };
      });

      // @ts-ignore
      this.table(tableName).hook('deleting', (primKey, obj, transaction) => {
        if (isRemoteSyncWriteInProgress()) return;
        if (tableName === 'workout_exercises_def' && !obj?.user_id) return;
        setTimeout(() => {
          this.sync_queue.add({
            table: tableName,
            action: 'delete',
            data: { id: primKey },
            created_at: Date.now()
          }).catch(err => console.error(`[DB] Failed to add to sync_queue for ${tableName}:`, err));
        }, 0);
      });
    });
  }
}

export const db = new MyDatabase();
