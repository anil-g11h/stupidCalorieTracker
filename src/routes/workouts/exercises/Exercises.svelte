<script lang="ts">
    // Ensure /# is present in the URL on page load for SPA hash routing
    if (typeof window !== 'undefined') {
      const expectedPrefix = `/${BASE_URL}/#`;
      const { pathname, hash } = window.location;
      if (!pathname.startsWith(`/${BASE_URL}`) || !hash) {
        // If not already at /BASE_URL/#, redirect to it, preserving any hash/query
        const afterBase = pathname.replace(`/${BASE_URL}`, '');
        const newUrl = `/${BASE_URL}/#${afterBase}${window.location.search || ''}`;
        if (window.location.pathname !== `/${BASE_URL}/` || !window.location.hash) {
          window.location.replace(newUrl);
        }
      }
    }
  import { db, type WorkoutExerciseDef } from '$lib/db';
  import { liveQuery } from 'dexie';
  import { generateId } from '../../../lib';
  import { METRIC_TYPES, type MetricType } from '../../../lib/workouts';

  import { BASE_URL } from '../../../lib/constants';
  function getParam(name: string) {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return params.get(name);
  }
  let workoutId = getParam('workoutId');

  // Reactively update workoutId if hash changes
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
      workoutId = getParam('workoutId');
    });
  }
  let searchTerm = '';
  let exercises: WorkoutExerciseDef[] = [];
  let isCreating = false;
  let newName = '';
  let newMuscle = 'Chest';
  let newEquipment = 'Barbell';
  let newMetric: MetricType = 'weight_reps';

  // Multi-select state
  let selected: Record<string, boolean> = {};

  // For navigation
  import { push as goto } from 'svelte-spa-router';
  // Use BASE_URL for navigation

  // View Transition API navigation for create page
  function handleCreateClick() {
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(() => {
        goto(`/${BASE_URL}/#/workouts/exercises/new`);
      });
    } else {
      goto(`/${BASE_URL}/#/workouts/exercises/new`);
    }
  }
  const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Other'];
  const EQUIPMENT_TYPES = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'None'];

  let subscription: any;
  function loadExercises() {
    if (subscription) subscription.unsubscribe?.();
    subscription = liveQuery(async () => {
      const all = await db.workout_exercises_def.toArray();
      if (!searchTerm) {
        return all.sort((a,b) => a.name.localeCompare(b.name));
      }
      const lower = searchTerm.toLowerCase();
      return all.filter(e =>
        e.name.toLowerCase().includes(lower) ||
        (e.muscle_group && e.muscle_group.toLowerCase().includes(lower))
      ).sort((a,b) => a.name.localeCompare(b.name));
    }).subscribe(data => {
      exercises = data;
      if (data.length === 0 && !searchTerm) {
        seedDefaults();
      }
    });
  }
  loadExercises();

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
          metric_type: d.metric_type,
          created_at: new Date(),
          synced: 0
        });
      }
    });
  }


  function toggleSelect(exercise: WorkoutExerciseDef) {
    selected[exercise.id] = !selected[exercise.id];
    // Force update
    selected = { ...selected };
  }

  async function addSelectedExercises() {
    if (!workoutId) return;
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (ids.length === 0) return;
    const existing = await db.workout_log_entries.where('workout_id').equals(workoutId).toArray();
    let sortOrder = (existing.map(e => e.sort_order).sort((a, b) => b - a)[0] || 0) + 1;
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
    // Optionally clear selection
    selected = {};
    // Navigate back to workout page
    goto(`/workouts/${workoutId}`);
  }

  async function createExercise() {
    if (!newName) return;
    await db.workout_exercises_def.add({
      id: generateId(),
      user_id: null,
      name: newName,
      muscle_group: newMuscle,
      equipment: newEquipment,
      metric_type: newMetric,
      created_at: new Date(),
      synced: 0
    });
    isCreating = false;
    newName = '';
    loadExercises();
  }
</script>

<div class="pb-24 pt-4 px-4 max-w-md mx-auto">
  <header class="flex items-center mb-6">
    <button class="text-blue-700 border-none rounded px-3 py-1 text-sm hover:bg-blue-800/80 transition-colors" on:click={() => goto(`/workouts/${workoutId}`)}>
      Cancel
    </button>
    <h1 class="flex-1 text-center text-main text-md">Add Exercises</h1>
    <button class="text-blue-700 px-4 py-2 rounded-full text-sm flex items-center gap-2 hover:bg-blue-50 transition-colors" on:click={() => goto('/workouts/exercises/new')}>
      Create
    </button>
  </header>
  {#if !isCreating}
    <input type="text" placeholder="Search exercises..." bind:value={searchTerm} class="w-full p-2 border rounded mb-4" />
    <div class="space-y-3">
      {#each exercises as exercise (exercise.id)}
        <div
          class="bg-card p-4 rounded-xl shadow-sm border border-border-subtle flex items-center cursor-pointer transition-all"
          style="border-left: 6px solid {selected[exercise.id] ? '#2563eb' : 'transparent'};"
          on:click={() => toggleSelect(exercise)}
        >
          <div>
            <div class="font-semibold text-lg">{exercise.name}</div>
            <div class="text-xs text-text-muted mt-1">{exercise.muscle_group} • {exercise.equipment}</div>
          </div>
        </div>
      {/each}
    </div>
    {#if Object.keys(selected).filter((id) => selected[id]).length > 0}
      <button class="w-full bg-brand text-white py-2 rounded-lg font-semibold mt-6" on:click={addSelectedExercises}>
        Add {Object.keys(selected).filter((id) => selected[id]).length} exercise{Object.keys(selected).filter((id) => selected[id]).length > 1 ? 's' : ''}
      </button>
    {/if}
  {/if}
  {#if isCreating}
    <div class="mt-6 bg-surface p-4 rounded-xl border border-border-subtle">
      <h2 class="text-lg font-bold mb-2">Create New Exercise</h2>
      <input type="text" placeholder="Exercise name" bind:value={newName} class="w-full p-2 border rounded mb-2" />
      <select bind:value={newMuscle} class="w-full p-2 border rounded mb-2">
        {#each MUSCLE_GROUPS as group}
          <option value={group}>{group}</option>
        {/each}
      </select>
      <select bind:value={newEquipment} class="w-full p-2 border rounded mb-2">
        {#each EQUIPMENT_TYPES as eq}
          <option value={eq}>{eq}</option>
        {/each}
      </select>
      <select bind:value={newMetric} class="w-full p-2 border rounded mb-2">
        {#each METRIC_TYPES as mt}
          <option value={mt}>{mt}</option>
        {/each}
      </select>
      <button class="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold mt-2" on:click={createExercise}>
        Save Exercise
      </button>
    </div>
  {/if}
</div>
