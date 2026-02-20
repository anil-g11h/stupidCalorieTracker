<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Activity } from '$lib/db';
  import { format, addDays, subDays, parseISO } from 'date-fns';
  import { goto } from '$app/navigation';
  import { generateId } from '$lib';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';

  // State
  let date = $state(new Date());
  let activities = $state<Activity[]>([]);
  let logs = $state<any[]>([]);
  
  // Timer State
  let activeTimer = $state<{ activityId: string, startTime: number } | null>(null);
  let elapsedSeconds = $state(0);
  let selectedActivityId = $state('');

  // Format date for DB query
  let dateStr = $derived(format(date, 'yyyy-MM-dd'));

  // Load Data
  $effect(() => {
    // Access reactivity here to track dependency
    dateStr;

    const subscription = liveQuery(async () => {
      // Fetch logs for the date
      const dayLogs = await db.activity_logs
        .where('date')
        .equals(dateStr)
        .toArray();
      
      // Fetch ALL activities (removed filter)
      const acts = await db.activities.toArray();
      
      return { dayLogs, acts };
    }).subscribe(result => {
      logs = result.dayLogs;
      activities = result.acts;
    });

    return () => subscription.unsubscribe();
  });

  // Timer Logic
  onMount(() => {
    const stored = localStorage.getItem('active_timer');
    if (stored) {
      try {
        activeTimer = JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse active timer", e);
      }
    }
  });

  $effect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (activeTimer) {
      // Update immediately
      elapsedSeconds = Math.floor((Date.now() - activeTimer.startTime) / 1000);
      
      interval = setInterval(() => {
        elapsedSeconds = Math.floor((Date.now() - activeTimer!.startTime) / 1000);
      }, 1000);
    } else {
      elapsedSeconds = 0;
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  });

  function formatElapsed(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function startTimer() {
    if (!selectedActivityId) return;
    
    const now = Date.now();
    const timerState = { activityId: selectedActivityId, startTime: now };
    
    activeTimer = timerState;
    localStorage.setItem('active_timer', JSON.stringify(timerState));
  }

  async function stopTimer() {
    if (!activeTimer) return;
    
    const endTime = Date.now();
    const startTimeComp = activeTimer.startTime;
    const durationMinutes = Math.round((endTime - startTimeComp) / 60000);
    const actId = activeTimer.activityId;
    
    // Clear timer state first
    localStorage.removeItem('active_timer');
    activeTimer = null;
    selectedActivityId = ''; // Reset selection or keep it? Resetting is safer.

    // Calculate calories
    const act = activities.find(a => a.id === actId);
    let calories = 0;
    if (act && act.calories_per_hour) {
        calories = Math.round((act.calories_per_hour / 60) * durationMinutes);
    }
    
    // Log Activity
    // Note: We use the creation date (today) for logging, even if it spans midnight, as per "Simpler" requirement.
    const logDateStr = format(new Date(startTimeComp), 'yyyy-MM-dd');

    await db.activity_logs.add({
      id: generateId(),
      user_id: 'local-user',  
      date: logDateStr,
      activity_id: actId,
      start_time: new Date(startTimeComp).toISOString(),
      end_time: new Date(endTime).toISOString(),
      duration_minutes: durationMinutes,
      calories_burned: calories,
      synced: 0,
      created_at: new Date()
    });
    
    // If we are looking at a different date, switch to today so we see the log? 
    // Or just let it be. If user logged for "today", they should be on "today".
    if (logDateStr !== dateStr) {
      date = new Date(); // Go to today
    }
  }

  // Calculations
  let totalMinutes = $derived(logs.reduce((sum, log) => sum + log.duration_minutes, 0));
  let hours = $derived(Math.floor(totalMinutes / 60));
  let mins = $derived(totalMinutes % 60);
  
  let leisureMinutes = $derived((24 * 60) - totalMinutes);
  let leisureHours = $derived(Math.floor(leisureMinutes / 60));
  let leisureMins = $derived(leisureMinutes % 60);

  // Derived activity stats
  let activityStats = $derived.by(() => {
    return activities.map(activity => {
      // Calculate current minutes from logs for this activity
      const currentMinutes = logs
        .filter(l => l.activity_id === activity.id)
        .reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
      
      return {
        id: activity.id,
        name: activity.name,
        category: activity.category,
        currentMinutes,
        targetMinutes: activity.target_duration_minutes || 0,
        targetType: activity.target_type || 'min'
      };
    })
    .filter(stat => stat.targetMinutes > 0 || stat.currentMinutes > 0)
    .sort((a, b) => b.currentMinutes - a.currentMinutes);
  });

  function getActivityName(id: string) {
    return activities.find(a => a.id === id)?.name || 'Unknown';
  }

  function getActivityCategory(id: string) {
     return activities.find(a => a.id === id)?.category;
  }

  function getProgressColor(current: number, target: number, type: string) {
    if (type === 'max') {
      return current > target ? 'bg-rose-500' : 'bg-emerald-500';
    }
    // Min goal
    return current >= target ? 'bg-emerald-500' : 'bg-amber-400';
  }
</script>

<div class="px-4 py-6 pb-24 max-w-lg mx-auto">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <h1 class="text-2xl font-bold text-text-main">Time</h1>
    <a href="{base}/time/activities" class="text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors">
      Manage Activities →
    </a>
  </div>

  <div class="flex items-center gap-2 bg-surface rounded-lg p-1 mb-8 justify-center">
    <button class="p-2 hover:bg-card rounded-md shadow-sm transition-all text-text-main" onclick={() => date = subDays(date, 1)}>←</button>
    <span class="font-medium px-2 min-w-[100px] text-center text-text-main">{format(date, 'MMM d')}</span>
    <button class="p-2 hover:bg-card rounded-md shadow-sm transition-all text-text-main" onclick={() => date = addDays(date, 1)}>→</button>
  </div>

  <!-- Timer Card -->
  <div class="bg-card p-6 rounded-2xl border border-border-subtle shadow-lg mb-8 text-center ring-1 ring-border-subtle">
    {#if activeTimer}
      <div class="mb-4">
        <h3 class="text-lg font-semibold text-text-main">{getActivityName(activeTimer.activityId)}</h3>
        <p class="text-sm text-text-muted">Timer Running</p>
      </div>
      <div class="text-5xl font-mono font-bold text-text-main mb-6 tabular-nums tracking-wider text-emerald-600 dark:text-emerald-500">
        {formatElapsed(elapsedSeconds)}
      </div>
      <button 
        onclick={stopTimer}
        class="w-full bg-rose-500 text-white font-bold py-4 rounded-xl shadow-md hover:bg-rose-600 transition-all active:scale-[0.98]"
      >
        Stop Timer
      </button>
    {:else}
      <div class="mb-4">
        <label for="activity-select" class="block text-sm font-medium text-text-muted mb-2">Select Activity</label>
        <select 
          id="activity-select"
          bind:value={selectedActivityId}
          class="w-full px-4 py-3 rounded-xl border border-border-subtle bg-surface text-text-main focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
        >
          <option value="" disabled selected>Choose an activity...</option>
          {#each activities as activity}
             <option value={activity.id}>{activity.name}</option>
          {/each}
        </select>
      </div>
      <button 
        onclick={startTimer}
        disabled={!selectedActivityId}
        class="w-full bg-emerald-500 text-white font-bold py-4 rounded-xl shadow-md hover:bg-emerald-600 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Start Timer
      </button>
    {/if}
  </div>

  <!-- Summary Cards -->
  <div class="grid grid-cols-2 gap-4 mb-8">
    <div class="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/50">
      <div class="text-emerald-600 dark:text-emerald-400 text-sm font-medium mb-1">Tracked</div>
      <div class="text-3xl font-bold text-emerald-900 dark:text-emerald-100">{hours}h {mins}m</div>
    </div>
    <div class="bg-indigo-50 dark:bg-indigo-950/30 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/50">
      <div class="text-indigo-600 dark:text-indigo-400 text-sm font-medium mb-1">Untracked</div>
      <div class="text-3xl font-bold text-indigo-900 dark:text-indigo-100">{leisureHours}h {leisureMins}m</div>
    </div>
  </div>

  <!-- Goal Progress Section -->
  {#if activityStats.some(s => s.targetMinutes > 0)}
    <div class="mb-8 space-y-4">
      <h2 class="text-lg font-semibold text-text-main">Goal Progress</h2>
      <div class="space-y-3">
        {#each activityStats.filter(s => s.targetMinutes > 0) as stat}
          <div class="bg-card p-3 rounded-xl border border-border-subtle shadow-sm">
            <div class="flex justify-between items-center mb-2">
              <span class="font-medium text-text-main">{stat.name}</span>
              <span class="text-xs font-medium text-text-muted">
                {Math.floor(stat.currentMinutes / 60)}h {stat.currentMinutes % 60}m / {Math.floor(stat.targetMinutes / 60)}h {stat.targetMinutes % 60}m 
                <span class="text-text-muted capitalize">({stat.targetType})</span>
              </span>
            </div>
            <div class="h-2 w-full bg-surface rounded-full overflow-hidden">
               <!-- Calculate width percentage carefully -->
               {#if stat.targetMinutes > 0}
                <div 
                  class="h-full rounded-full transition-all duration-500 {getProgressColor(stat.currentMinutes, stat.targetMinutes, stat.targetType!)}"
                  style="width: {Math.min((stat.currentMinutes / stat.targetMinutes) * 100, 100)}%"
                ></div>
               {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Activity List -->
  <div class="space-y-4">
    <h2 class="text-lg font-semibold text-text-main">Detailed Log</h2>
    {#each logs as log}
      <a href="{base}/time/log/{log.id}" class="bg-card p-4 rounded-2xl border border-border-subtle shadow-sm flex items-center justify-between hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors block">
        <div>
          <div class="flex items-center gap-2 mb-0.5">
            <span class="font-semibold text-text-main">{getActivityName(log.activity_id)}</span>
            {#if getActivityCategory(log.activity_id)}
              <span class="text-[10px] uppercase font-bold tracking-wider text-text-muted bg-surface px-1.5 py-0.5 rounded-full">
                {getActivityCategory(log.activity_id)}
              </span>
            {/if}
          </div>
          <div class="text-sm text-text-muted">
            {#if log.start_time}
               {format(parseISO(log.start_time), 'HH:mm')} - {format(parseISO(log.end_time), 'HH:mm')}
            {:else}
               {Math.floor(log.duration_minutes / 60)}h {log.duration_minutes % 60}m
            {/if}
          </div>
        </div>
        <div class="font-medium text-zinc-900 bg-zinc-50 px-3 py-1 rounded-lg">
          {log.duration_minutes}m
        </div>
      </a>
    {/each}

    <a href="{base}/time/add?date={dateStr}" class="block w-full py-4 rounded-2xl border-2 border-dashed border-zinc-200 text-zinc-400 font-medium text-center hover:border-zinc-300 hover:text-zinc-500 transition-all">
      + Log Activity
    </a>
  </div>
</div>
