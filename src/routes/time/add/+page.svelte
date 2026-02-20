<script lang="ts">
  import { db } from '$lib/db';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
    import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import { generateId } from '$lib';
  
  let dateStr = $state($page.url.searchParams.get('date') || new Date().toISOString().split('T')[0]);
  
  let activities = $state<any[]>([]);
  let selectedActivityId = $state('');
  let newActivityName = $state('');
  let isCreatingNew = $state(false);

  // Time Inputs
  let startTime = $state('09:00');
  let endTime = $state('10:00');

  $effect(() => {
    const sub = liveQuery(() => db.activities.toArray()).subscribe(acts => {
      activities = acts;
    });
    return () => sub.unsubscribe();
  });

  async function save() {
    let activityId = selectedActivityId;
    
    // Create new activity if needed
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

    // Calculate duration
    const start = new Date(`${dateStr}T${startTime}`);
    let end = new Date(`${dateStr}T${endTime}`);
    if (end < start) end.setDate(end.getDate() + 1); // Handle overnight
    
    // Check if the activity spans across midnight
    const isOvernight = end.getDate() !== start.getDate();

    let caloriesPerHour = 0;
    if (isCreatingNew) {
         // for new activity, calories are 0 as defined when creating it above
         caloriesPerHour = 0;
    } else {
        const activity = activities.find(a => a.id === activityId);
        if (activity) {
            caloriesPerHour = activity.calories_per_hour || 0;
        }
    }

    if (isOvernight) {
      // Split into two logs
      
      // Log 1: Start time to Midnight
      const midnight = new Date(start);
      midnight.setHours(24, 0, 0, 0); // Next day 00:00:00
      
      const duration1 = Math.round((midnight.getTime() - start.getTime()) / 60000);
      const calories1 = Math.round((duration1 / 60) * caloriesPerHour);
      
      await db.activity_logs.add({
        id: generateId(),
        user_id: 'local-user',
        date: dateStr,
        activity_id: activityId,
        start_time: start.toISOString(),
        end_time: midnight.toISOString(),
        duration_minutes: duration1,
        calories_burned: calories1,
        synced: 0,
        // @ts-ignore
        created_at: new Date()
      });

      // Log 2: Midnight to End time
      const nextDayStr = midnight.toISOString().split('T')[0];
      const duration2 = Math.round((end.getTime() - midnight.getTime()) / 60000);
      const calories2 = Math.round((duration2 / 60) * caloriesPerHour);
      
      await db.activity_logs.add({
        id: generateId(),
        user_id: 'local-user',
        date: nextDayStr,
        activity_id: activityId,
        start_time: midnight.toISOString(),
        end_time: end.toISOString(),
        duration_minutes: duration2,
        calories_burned: calories2,
        synced: 0,
        // @ts-ignore
        created_at: new Date()

      });

    } else {
      // Single log (same day)
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
      const calories = Math.round((durationMinutes / 60) * caloriesPerHour);

      await db.activity_logs.add({
        id: generateId(),
        user_id: 'local-user',
        date: dateStr,
        activity_id: activityId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration_minutes: durationMinutes,
        calories_burned: calories,
        synced: 0,
        created_at: new Date()
      });
    }

    goto(`${base}/time`);
  }
</script>

<div class="px-4 py-6 max-w-lg mx-auto">
  <h1 class="text-2xl font-bold mb-6 text-text-main">Log Activity</h1>
  
  <div class="space-y-6">
    <!-- Date Selection -->
    <div>
      <label for="activity-date" class="block text-sm font-medium text-text-muted mb-2">Date</label>
      <input id="activity-date" type="date" bind:value={dateStr} class="w-full p-3 rounded-xl border border-border-subtle bg-card text-text-main" />
    </div>

    <!-- Activity Selection -->
    <div>
      <label for="activity-select" class="block text-sm font-medium text-text-muted mb-2">Activity</label>
      {#if !isCreatingNew}
        <select 
            id="activity-select"
            bind:value={selectedActivityId} 
            onchange={(e) => {
                // @ts-ignore
                if (e.currentTarget.value === 'NEW') {
                    isCreatingNew = true;
                    selectedActivityId = '';
                }
            }}
            class="w-full p-3 rounded-xl border border-border-subtle bg-card text-text-main">
          <option value="" disabled selected>Select activity...</option>
          {#each activities as act}
            <option value={act.id}>{act.name}</option>
          {/each}
          <option value="NEW">+ Create New Activity</option>
        </select>
      {:else}
        <div class="flex gap-2">
           <input id="new-activity-name" bind:value={newActivityName} placeholder="E.g. Coding" class="flex-1 p-3 rounded-xl border border-border-subtle bg-card text-text-main" />
           <button onclick={() => isCreatingNew = false} class="text-sm text-text-muted hover:text-text-main">Cancel</button>
        </div>
      {/if}
    </div>

    <!-- Time Inputs -->
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="activity-start" class="block text-sm font-medium text-text-muted mb-2">Start</label>
        <input id="activity-start" type="time" bind:value={startTime} class="w-full p-3 rounded-xl border border-border-subtle bg-card text-text-main" />
      </div>
      <div>
        <label for="activity-end" class="block text-sm font-medium text-text-muted mb-2">End</label>
        <input id="activity-end" type="time" bind:value={endTime} class="w-full p-3 rounded-xl border border-border-subtle bg-card text-text-main" />
      </div>
    </div>

    <!-- Actions -->
    <div class="pt-4 flex gap-3">
      <button onclick={save} class="flex-1 bg-brand text-brand-fg py-3 rounded-xl font-medium shadow-sm hover:opacity-90 active:scale-[0.98] transition-all">Save</button>
      <a href="{base}/time" class="px-6 py-3 rounded-xl border border-border-subtle text-text-main font-medium hover:bg-surface transition-all">Cancel</a>
    </div>
  </div>
</div>
