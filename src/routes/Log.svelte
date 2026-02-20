<script lang="ts">
  import { db, type DailyLog, type Food } from '$lib/db';
  import { liveQuery } from 'dexie';
  import { onMount, onDestroy } from 'svelte';
  import { Utensils, ChevronLeft, ChevronRight, Calendar } from 'lucide-svelte';
  import {replace} from 'svelte-spa-router';

  // Date State
  import { BASE_URL } from '$lib/constants';
  // Use hash for query params in SPA routing
  function getParam(name: string) {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return params.get(name);
  }
  let date = getParam('date') || new Date().toISOString().split('T')[0];
  
  
  // Date Display Logic
  $: displayDate = new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  $: isToday = date === new Date().toISOString().split('T')[0];
  
  function changeDate(days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    date = d.toISOString().split('T')[0];
    replace(`?date=${date}`);
  }

  // Data State
  let logs: DailyLog[] = [];
  let foodsMap: Record<string, Food> = {};
  let subscription: any;

  // Reactive Fetching
  $: loadData(date);

  // Goals State
  let goals = {
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 65
  };

  function loadData(currentDate: string) {
    if (subscription) subscription.unsubscribe();
    
    subscription = liveQuery(async () => {
      // 1. Get logs for date
      const daysLogs = await db.logs.where('date').equals(currentDate).toArray();
      
      // 2. Get unique food IDs
      const foodIds = [...new Set(daysLogs.map(l => l.food_id))];
      
      // 3. Get foods
      const foods = await db.foods.where('id').anyOf(foodIds).toArray();

      // 4. Get active goal for this date
      const goal = await db.goals
        .where('start_date')
        .belowOrEqual(currentDate)
        .reverse()
        .first();
      
      return { daysLogs, foods, goal };
    }).subscribe(result => {
      if (result) {
        logs = result.daysLogs;
        foodsMap = result.foods.reduce((acc, food) => {
          acc[food.id] = food;
          return acc;
        }, {} as Record<string, Food>);

        if (result.goal) {
          goals = {
            calories: result.goal.calories_target,
            protein: result.goal.protein_target,
            carbs: result.goal.carbs_target,
            fat: result.goal.fat_target
          };
        }
      }
    });
  }
  
  onDestroy(() => {
    if (subscription) subscription.unsubscribe();
  });

  // Derived State: Grouped Logs & Totals
  interface ExtendedLog extends DailyLog {
    food?: Food;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }

  $: extendedLogs = logs.map(log => {
    const food = foodsMap[log.food_id];
    if (!food) return { ...log, calories: 0, protein: 0, carbs: 0, fat: 0 };
    return {
      ...log,
      food,
      calories: Math.round(food.calories * log.amount_consumed),
      protein: Math.round(food.protein * log.amount_consumed),
      carbs: Math.round(food.carbs * log.amount_consumed),
      fat: Math.round(food.fat * log.amount_consumed)
    };
  }) as ExtendedLog[];

  $: groupedLogs = {
    breakfast: extendedLogs.filter(l => l.meal_type === 'breakfast'),
    lunch: extendedLogs.filter(l => l.meal_type === 'lunch'),
    dinner: extendedLogs.filter(l => l.meal_type === 'dinner'),
    snack: extendedLogs.filter(l => l.meal_type === 'snack'),
    supplement: extendedLogs.filter(l => l.meal_type === 'supplement')
  };

  $: dailyTotals = extendedLogs.reduce((acc, log) => ({
    calories: acc.calories + log.calories,
    protein: acc.protein + log.protein,
    carbs: acc.carbs + log.carbs,
    fat: acc.fat + log.fat
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  async function deleteLog(id: string) {
    if (confirm('Delete this entry?')) {
      await db.logs.delete(id);
    }
  }
</script>


<div class="min-h-screen bg-page pb-20 font-sans">
  <!-- Header -->
  <header class="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
    <div class="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
      <h1 class="text-xl font-bold text-text-main">Daily Log</h1>
      
      <div class="flex items-center justify-between w-auto bg-surface rounded-full px-1 py-1 border border-border-subtle shadow-sm">
        <button 
          class="p-2 hover:bg-card rounded-full transition-colors text-text-muted hover:text-text-main"
          on:click={() => changeDate(-1)}
          aria-label="Previous day"
        >
          <ChevronLeft size={18} />
        </button>
        
        <div class="flex flex-col items-center px-4 cursor-pointer relative group">
          <input 
            type="date" 
            bind:value={date} 
            class="absolute inset-0 opacity-0 cursor-pointer z-10"
          />
          <span class="text-sm font-bold text-text-main leading-none flex items-center gap-1.5">
            <Calendar size={12} class="text-brand" />
            {isToday ? 'Today' : displayDate}
          </span>
          {#if !isToday}
            <span class="text-[10px] text-text-muted leading-none mt-0.5">{displayDate}</span>
          {/if}
        </div>

        <button 
          class="p-2 hover:bg-card rounded-full transition-colors text-text-muted hover:text-text-main"
          on:click={() => changeDate(1)}
          aria-label="Next day"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <a href="/#/foods" class="text-text-muted hover:text-brand transition-colors p-2" aria-label="Manage Foods">
        <Utensils size={20} />
      </a>
    </div>
  </header>

  <main class="max-w-md mx-auto p-4 space-y-6">
    <!-- Summary Card -->
  <div class="bg-card rounded-2xl shadow-sm p-6 border border-border-subtle mb-8">
    <div class="flex justify-between items-end mb-2">
      <div>
        <p class="text-sm text-text-muted font-medium uppercase tracking-wide">Calories</p>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="text-4xl font-extrabold text-text-main">{Math.round(dailyTotals.calories)}</span>
          <span class="text-sm text-text-muted font-medium">/ {goals.calories}</span>
        </div>
      </div>
      <div class="text-right mb-1">
        <p class="text-xs font-bold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 px-3 py-1 rounded-full inline-block">
          {Math.round(goals.calories - dailyTotals.calories)} LEFT
        </p>
      </div>
    </div>

    <!-- Calorie Progress Bar -->
    <div class="h-4 bg-surface rounded-full overflow-hidden mb-8 shadow-inner">
      <div 
        class="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-700 ease-out shadow-sm"
        style="width: {Math.min((dailyTotals.calories / goals.calories) * 100, 100)}%"
      ></div>
    </div>

    <!-- Macros Grid -->
    <div class="grid grid-cols-3 gap-6">
      <!-- Protein -->
      <div class="text-center">
        <p class="text-xs text-text-muted mb-2 font-medium">Protein</p>
        <div class="relative h-2 bg-surface rounded-full mb-2">
          <div 
            class="absolute top-0 left-0 h-full bg-macro-protein rounded-full transition-all duration-500" 
            style="width: {Math.min((dailyTotals.protein / goals.protein) * 100, 100)}%"
          ></div>
        </div>
        <p class="text-xs font-bold text-text-main">{Math.round(dailyTotals.protein)} <span class="text-text-muted font-normal">/ {goals.protein}g</span></p>
      </div>
      <!-- Carbs -->
      <div class="text-center">
        <p class="text-xs text-text-muted mb-2 font-medium">Carbs</p>
        <div class="relative h-2 bg-surface rounded-full mb-2">
          <div 
            class="absolute top-0 left-0 h-full bg-macro-carbs rounded-full transition-all duration-500" 
            style="width: {Math.min((dailyTotals.carbs / goals.carbs) * 100, 100)}%"
          ></div>
        </div>
        <p class="text-xs font-bold text-text-main">{Math.round(dailyTotals.carbs)} <span class="text-text-muted font-normal">/ {goals.carbs}g</span></p>
      </div>
      <!-- Fat -->
      <div class="text-center">
        <p class="text-xs text-text-muted mb-2 font-medium">Fat</p>
        <div class="relative h-2 bg-surface rounded-full mb-2">
          <div 
            class="absolute top-0 left-0 h-full bg-macro-fat rounded-full transition-all duration-500" 
            style="width: {Math.min((dailyTotals.fat / goals.fat) * 100, 100)}%"
          ></div>
        </div>
        <p class="text-xs font-bold text-text-main">{Math.round(dailyTotals.fat)} <span class="text-text-muted font-normal">/ {goals.fat}g</span></p>
      </div>
    </div>
  </div>

  <!-- Meal Sections -->
  {#each ['breakfast', 'lunch', 'dinner', 'snack', 'supplement'] as meal}
    <div class="mb-6">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-lg font-bold capitalize text-text-main">{meal}</h3>
        <span class="text-sm text-text-muted font-medium">
          {groupedLogs[meal as keyof typeof groupedLogs].reduce((sum, log) => sum + log.calories, 0)} kcal
        </span>
      </div>
      
      <div class="space-y-3">
        {#each groupedLogs[meal as keyof typeof groupedLogs] as log (log.id)}
          <div class="bg-card p-4 rounded-xl shadow-sm border border-border-subtle flex justify-between items-center transition-colors">
            <div>
              <div class="flex justify-between items-start w-full">
                <div>
                  <div class="font-medium text-text-main">
                    {log.food?.name || 'Unknown Food'}
                    <span class="text-xs text-text-muted font-normal ml-1">
                      {#if log.food?.serving_unit && /^(g|ml|oz)$/i.test(log.food.serving_unit)}
                        ({Math.round(log.amount_consumed * (log.food.serving_size || 100))}{log.food.serving_unit})
                      {:else}
                         ({log.amount_consumed} {log.food?.serving_unit || 'svg'})
                      {/if}
                    </span>
                  </div>
                  <div class="text-xs text-text-muted mt-0.5">
                    {log.calories} kcal • {log.protein}p • {log.carbs}c • {log.fat}f
                  </div>
                </div>
              </div>
            </div>
            <button 
              on:click={() => deleteLog(log.id)}
              class="text-text-muted hover:text-red-500 p-2 transition-colors"
            >
              &times;
            </button>
          </div>
        {/each}

        <a
          href="#base/log/add?date={date}&meal={meal}"
          class="block w-full text-center py-3 border-2 border-dashed border-border-subtle rounded-xl text-text-muted hover:border-brand hover:text-brand hover:bg-surface transition-all text-sm font-medium"
        >
          + Add Food
        </a>
      </div>
    </div>
  {/each}
  </main>
</div>