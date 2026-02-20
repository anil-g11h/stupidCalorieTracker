<script lang="ts">
  import { db, type Food } from '../../../lib/db';
  import { generateId } from '../../../lib';
  import { liveQuery } from 'dexie';
  import { push } from 'svelte-spa-router';
  import { onMount, onDestroy } from 'svelte';

  // Get query params from hash
  import { BASE_URL } from '../../../lib/constants';
  function getParam(name: string) {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return params.get(name);
  }
  let date = getParam('date') || new Date().toISOString().split('T')[0];
  let mealType = getParam('meal') || 'breakfast';
  let logId = getParam('log_id');

  let searchQuery = '';
  let searchResults: Food[] = [];
  let selectedFood: Food | null = null;
  let inputValue = 1;
  let selectedUnit = 'serving';
  let subscription: any;

  onMount(async () => {
    if (logId) {
      const log = await db.logs.get(logId);
      if (log) {
        mealType = log.meal_type || mealType;
        const food = await db.foods.get(log.food_id);
        if (food) {
          selectedFood = food;
          const _isWeightBased = food.serving_unit && WEIGHT_BASED_REGEX.test(food.serving_unit);
          if (_isWeightBased) {
             selectedUnit = food.serving_unit!;
             inputValue = Math.round(log.amount_consumed * (food.serving_size || 100));
          } else {
             selectedUnit = 'serving';
             inputValue = log.amount_consumed;
          }
        }
      }
    }
  });

  const WEIGHT_BASED_REGEX = /^(g|ml|oz)$/i;
  $: isWeightBased = selectedFood?.serving_unit && WEIGHT_BASED_REGEX.test(selectedFood.serving_unit);
  $: quantity = calculateQuantity(inputValue, selectedUnit, selectedFood);
  function calculateQuantity(val: number, unit: string, food: Food | null) {
      if (!food) return 1;
      if (unit === 'serving') return val;
      const size = food.serving_size || 1;
      return size > 0 ? val / size : val;
  }
  $: performSearch(searchQuery);
  function performSearch(query: string) {
    if (subscription) subscription.unsubscribe();
    if (query.trim().length > 0) {
      subscription = liveQuery(async () => {
        return await db.foods
          .filter(food => food.name.toLowerCase().includes(query.toLowerCase()))
          .limit(20)
          .toArray();
      }).subscribe(results => {
        searchResults = results || [];
      });
    } else {
      subscription = liveQuery(async () => {
          return await db.foods.limit(20).toArray();
      }).subscribe(results => {
        searchResults = results || [];
      });
    }
  }
  onDestroy(() => {
    if (subscription) subscription.unsubscribe();
  });
  $: calories = selectedFood ? (selectedFood.calories * quantity).toFixed(0) : 0;
  $: protein = selectedFood ? (selectedFood.protein * quantity).toFixed(1) : 0;
  $: carbs = selectedFood ? (selectedFood.carbs * quantity).toFixed(1) : 0;
  $: fat = selectedFood ? (selectedFood.fat * quantity).toFixed(1) : 0;
  function selectFood(food: Food) {
    selectedFood = food;
    const _isWeightBased = food.serving_unit && WEIGHT_BASED_REGEX.test(food.serving_unit);
    if (_isWeightBased) {
        selectedUnit = food.serving_unit!;
        inputValue = food.serving_size || 100;
    } else {
        selectedUnit = 'serving';
        inputValue = 1;
    }
  }
  function clearSelection() {
    selectedFood = null;
    inputValue = 1;
    selectedUnit = 'serving';
  }
  function updateUnit(newUnit: string) {
      const servingSize = selectedFood?.serving_size || 1;
      if (newUnit === 'serving' && selectedUnit !== 'serving') {
          inputValue = parseFloat((inputValue / servingSize).toFixed(2));
      } else if (newUnit !== 'serving' && selectedUnit === 'serving') {
          inputValue = parseFloat((inputValue * servingSize).toFixed(1));
      }
      selectedUnit = newUnit;
  }
  async function saveLog() {
    if (!selectedFood) return;
    try {
      await db.logs.add({
        id: generateId(),
        user_id: 'local-user',
        date: date,
        meal_type: mealType,
        food_id: selectedFood.id,
        amount_consumed: quantity,
        synced: 0,
        created_at: new Date()
      });
      push(`/log?date=${date}`);
    } catch (error) {
      console.error('Failed to save log:', error);
      alert('Failed to save log');
    }
  }
</script>

<div class="container mx-auto p-4 max-w-md pb-24">
  <div class="flex items-center mb-4">
    <a href={`#/log?date=${date}`} class="mr-4 text-text-muted hover:text-text-main transition-colors">&larr; Back</a>
    <h1 class="text-2xl font-bold capitalize text-text-main">Add to {mealType}</h1>
  </div>
  {#if !selectedFood}
    <div class="mb-4">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search foods..."
        class="w-full p-3 bg-surface text-text-main border border-transparent rounded-lg shadow-sm focus:ring-2 focus:ring-brand focus:outline-none placeholder-text-muted"
      />
    </div>
    <div class="space-y-2">
      {#each searchResults as food}
        <button
          class="w-full text-left p-4 bg-card border border-border-subtle rounded-lg shadow-sm hover:bg-surface transition-colors flex justify-between items-center"
          on:click={() => selectFood(food)}
        >
          <div>
            <div class="font-bold text-lg text-text-main">{food.name}</div>
            <div class="text-sm text-text-muted">
                {food.brand ? `${food.brand} • ` : ''}
                {food.calories} cal
            </div>
          </div>
          <div class="text-brand text-2xl">+</div>
        </button>
      {:else}
        <div class="text-center text-text-muted mt-8">
            {#if searchQuery}
                No foods found matching "{searchQuery}"
            {:else}
                Start typing to search...
            {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="bg-card rounded-xl shadow-lg p-6 border border-border-subtle">
      <div class="flex justify-between items-start mb-4">
        <div>
            <h2 class="text-2xl font-bold text-text-main">{selectedFood.name}</h2>
            {#if selectedFood.brand}
                <p class="text-text-muted">{selectedFood.brand}</p>
            {/if}
        </div>
        <button on:click={clearSelection} class="text-text-muted hover:text-text-main">
            Close
        </button>
      </div>
      <div class="grid grid-cols-4 gap-2 mb-6 text-center">
          <div class="bg-surface p-2 rounded">
              <div class="text-xl font-bold text-text-main">{calories}</div>
              <div class="text-xs text-text-muted">Cal</div>
          </div>
          <div class="bg-surface p-2 rounded">
              <div class="text-xl font-bold text-macro-protein">{protein}g</div>
              <div class="text-xs text-text-muted">Prot</div>
          </div>
          <div class="bg-surface p-2 rounded">
              <div class="text-xl font-bold text-macro-carbs">{carbs}g</div>
              <div class="text-xs text-text-muted">Carb</div>
          </div>
          <div class="bg-surface p-2 rounded">
              <div class="text-xl font-bold text-macro-fat">{fat}g</div>
              <div class="text-xs text-text-muted">Fat</div>
          </div>
      </div>
      <div class="mb-6">
          <div class="flex justify-between items-center mb-2">
            <span class="block text-sm font-medium text-text-muted">
                Quantity
            </span>
            {#if isWeightBased}
                <div class="flex items-center space-x-2 bg-surface rounded-lg p-1">
                    <button 
                        class={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${selectedUnit === 'serving' ? 'bg-brand text-brand-fg shadow-sm' : 'text-text-muted hover:text-text-main'}`}
                        on:click={() => updateUnit('serving')}
                    >
                        Serving
                    </button>
                    <button 
                        class={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${selectedUnit !== 'serving' ? 'bg-brand text-brand-fg shadow-sm' : 'text-text-muted hover:text-text-main'}`}
                        on:click={() => updateUnit(selectedFood!.serving_unit!)}
                    >
                        {selectedFood.serving_unit || 'g'}
                    </button>
                </div>
            {/if}
          </div>
          <div class="flex items-center space-x-4">
              <button 
                class="w-12 h-12 rounded-full bg-surface text-text-main text-xl font-bold flex items-center justify-center hover:bg-border-subtle transition-colors"
                on:click={() => {
                    const step = selectedUnit === 'serving' ? 0.25 : 10;
                    inputValue = Math.max(step, inputValue - step);
                    if (selectedUnit !== 'serving') inputValue = Math.round(inputValue);
                }}
              >-</button>
              <div class="flex-1 relative">
                  <input 
                    type="number" 
                    bind:value={inputValue} 
                    step={selectedUnit === 'serving' ? 0.25 : 1}
                    min="0"
                    class="w-full p-3 text-center border bg-surface text-text-main border-transparent rounded-lg text-lg font-bold"
                  />
                  {#if !isWeightBased}
                    <span class="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted text-sm font-medium">
                        {selectedFood.serving_unit || 'svg'}
                    </span>
                  {/if}
              </div>
              <button 
                class="w-12 h-12 rounded-full bg-surface text-text-main text-xl font-bold flex items-center justify-center hover:bg-border-subtle transition-colors"
                on:click={() => {
                    const step = selectedUnit === 'serving' ? 0.25 : 10;
                    inputValue = inputValue + step;
                    if (selectedUnit !== 'serving') inputValue = Math.round(inputValue);
                }}
              >+</button>
          </div>
      </div>
      <button
        on:click={saveLog}
        class="w-full bg-brand text-brand-fg py-4 rounded-xl text-lg font-bold shadow-lg hover:opacity-90 transition-opacity"
      >
        Add to Log
      </button>
    </div>
  {/if}
</div>
