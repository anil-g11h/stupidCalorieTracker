<script lang="ts">
  import { db } from '../../../lib/db';
  import { BASE_URL } from '../../../lib/constants';
  import { liveQuery } from 'dexie';
  import { generateId } from '../../../lib';
  import { push } from 'svelte-spa-router';

  function getParam(name: string) {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return params.get(name);
  }
  let dateStr = getParam('date') || new Date().toISOString().split('T')[0];

  let activities: any[] = [];
  let selectedActivityId = '';
  let newActivityName = '';
  let isCreatingNew = false;
  let startTime = '09:00';
  let endTime = '10:00';

  let subscription: any;
  function loadActivities() {
    if (subscription) subscription.unsubscribe?.();
    subscription = liveQuery(() => db.activities.toArray()).subscribe(acts => {
      activities = acts;
    });
  }
  loadActivities();

  async function save() {
    let activityId = selectedActivityId;
    if (isCreatingNew && newActivityName) {
      const id = generateId();
      await db.activities.add({
        id,
        name: newActivityName,
        calories_per_hour: 0,
        synced: 0,
        created_at: new Date(),
        updated_at: new Date()
      });
      activityId = id;
    }
    if (!activityId) return;
    const start = new Date(`${dateStr}T${startTime}`);
    let end = new Date(`${dateStr}T${endTime}`);
    if (end < start) end.setDate(end.getDate() + 1);
    const isOvernight = end.getDate() !== start.getDate();
    let caloriesPerHour = 0;
    if (isCreatingNew) {
      caloriesPerHour = 0;
    } else {
      const activity = activities.find(a => a.id === activityId);
      if (activity) {
        caloriesPerHour = activity.calories_per_hour || 0;
      }
    }
    if (isOvernight) {
      const midnight = new Date(start);
      midnight.setHours(24, 0, 0, 0);
      const duration1 = Math.round((midnight.getTime() - start.getTime()) / 60000);
      const calories1 = Math.round((duration1 / 60) * caloriesPerHour);
      await db.activity_logs.add({
        id: generateId(),
        user_id: 'local-user',
        date: dateStr,
        activity_id: activityId,
        start_time: start.toISOString(),
        end_time: midnight.toISOString(),
        duration: duration1,
        calories: calories1,
        synced: 0,
        created_at: new Date(),
        updated_at: new Date()
      });
      const duration2 = Math.round((end.getTime() - midnight.getTime()) / 60000);
      const calories2 = Math.round((duration2 / 60) * caloriesPerHour);
      await db.activity_logs.add({
        id: generateId(),
        user_id: 'local-user',
        date: end.toISOString().split('T')[0],
        activity_id: activityId,
        start_time: midnight.toISOString(),
        end_time: end.toISOString(),
        duration: duration2,
        calories: calories2,
        synced: 0,
        created_at: new Date(),
        updated_at: new Date()
      });
    } else {
      const duration = Math.round((end.getTime() - start.getTime()) / 60000);
      const calories = Math.round((duration / 60) * caloriesPerHour);
      await db.activity_logs.add({
        id: generateId(),
        user_id: 'local-user',
        date: dateStr,
        activity_id: activityId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration,
        calories,
        synced: 0,
        created_at: new Date(),
        updated_at: new Date()
      });
    }
    push(`/time?date=${dateStr}`);
  }
</script>

<div class="px-4 py-6 max-w-lg mx-auto">
  <h1 class="text-2xl font-bold mb-6">Log Activity</h1>
  <form on:submit|preventDefault={save} class="space-y-4">
    <div>
      <label class="block text-sm font-medium mb-1">Date</label>
      <input type="date" bind:value={dateStr} class="w-full p-2 border rounded" />
    </div>
    <div>
      <label class="block text-sm font-medium mb-1">Activity</label>
      <select bind:value={selectedActivityId} class="w-full p-2 border rounded" disabled={isCreatingNew}>
        <option value="">Select activity</option>
        {#each activities as act}
          <option value={act.id}>{act.name}</option>
        {/each}
      </select>
      <div class="mt-2">
        <label class="inline-flex items-center">
          <input type="checkbox" bind:checked={isCreatingNew} />
          <span class="ml-2">Create new activity</span>
        </label>
      </div>
      {#if isCreatingNew}
        <input type="text" placeholder="New activity name" bind:value={newActivityName} class="w-full p-2 border rounded mt-2" />
      {/if}
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium mb-1">Start Time</label>
        <input type="time" bind:value={startTime} class="w-full p-2 border rounded" />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">End Time</label>
        <input type="time" bind:value={endTime} class="w-full p-2 border rounded" />
      </div>
    </div>
    <button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition shadow-sm mt-2">
      Save Activity Log
    </button>
  </form>
</div>
