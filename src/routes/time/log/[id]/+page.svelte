<script lang="ts">
  import { db } from '$lib/db';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
    import { base } from '$app/paths';
  import { liveQuery } from 'dexie';
  import { onMount } from 'svelte';
  import { format, parseISO } from 'date-fns';

  let logId = $page.params.id;
  
  let activities = $state<any[]>([]);
  let selectedActivityId = $state('');
  let dateStr = $state('');
  
  // Time Inputs
  let startTime = $state('');
  let endTime = $state('');

  let log = $state<any>(null);

  $effect(() => {
    const sub = liveQuery(() => db.activities.toArray()).subscribe(acts => {
      activities = acts;
    });
    return () => sub.unsubscribe();
  });

  onMount(async () => {
    log = await db.activity_logs.get(logId);
    if (log) {
        selectedActivityId = log.activity_id;
        dateStr = log.date;
        if (log.start_time && log.end_time) {
            startTime = format(parseISO(log.start_time), 'HH:mm');
            endTime = format(parseISO(log.end_time), 'HH:mm');
        }
    } else {
        alert('Log not found');
        goto(`${base}/time`);
    }
  });

  async function save() {
    if (!log) return;

    const start = new Date(`${dateStr}T${startTime}`);
    let end = new Date(`${dateStr}T${endTime}`);
    if (end < start) end.setDate(end.getDate() + 1); // Handle overnight
    
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

    await db.activity_logs.update(logId, {
      activity_id: selectedActivityId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_minutes: durationMinutes,
      synced: 0
    });

    goto(`${base}/time`);
  }

  async function deleteLog() {
    if (confirm('Delete this log entry?')) {
        await db.activity_logs.delete(logId);
        goto(`${base}/time`);
    }
  }
</script>

<div class="px-4 py-6 max-w-lg mx-auto">
  <div class="flex items-center justify-between mb-6">
     <h1 class="text-2xl font-bold text-text-main">Edit Log</h1>
     <button onclick={deleteLog} class="text-red-600 dark:text-red-400 font-medium hover:text-red-800 dark:hover:text-red-300 transition-colors">Delete</button>
  </div>
  
  {#if log}
  <div class="space-y-6">
    <!-- Activity Selection -->
    <div>
      <label for="activity" class="block text-sm font-medium text-text-muted mb-2">Activity</label>
      <select id="activity" bind:value={selectedActivityId} class="w-full p-3 rounded-xl border border-border-subtle bg-card text-text-main">
          <option value="" disabled>Select activity...</option>
          {#each activities as act}
            <option value={act.id}>{act.name}</option>
          {/each}
      </select>
    </div>

    <!-- Time Inputs -->
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="start" class="block text-sm font-medium text-text-muted mb-2">Start</label>
        <input id="start" type="time" bind:value={startTime} class="w-full p-3 rounded-xl border border-border-subtle bg-card text-text-main" />
      </div>
      <div>
        <label for="end" class="block text-sm font-medium text-text-muted mb-2">End</label>
        <input id="end" type="time" bind:value={endTime} class="w-full p-3 rounded-xl border border-border-subtle bg-card text-text-main" />
      </div>
    </div>

    <!-- Actions -->
    <div class="pt-4 flex gap-3">
      <button onclick={save} class="flex-1 bg-black text-white py-3 rounded-xl font-medium">Save Changes</button>
      <a href="{base}/time" class="px-6 py-3 rounded-xl border border-zinc-200 font-medium">Cancel</a>
    </div>
  </div>
  {:else}
    <p>Loading...</p>
  {/if}
</div>
