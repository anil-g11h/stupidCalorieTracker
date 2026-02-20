<script lang="ts">
  import { db } from '$lib/db';
  import { liveQuery } from 'dexie';
  import { onMount } from 'svelte';
  
  let searchQuery = '';
  
  // Create a live query for foods
  let foods = liveQuery(() => db.foods.toArray());

  // Filtered foods based on search query
  $: filteredFoods = $foods 
    ? $foods.filter(food => 
        food.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (food.brand && food.brand.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

</script>

<div class="container mx-auto p-4">
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold">Foods</h1>
    <div class="space-x-2">
      <a href="#/foods/new" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">
        Add Food
      </a>
      <a href="#/foods/new-recipe" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded">
        Create Recipe
      </a>
    </div>
  </div>

  <div class="mb-4">
    <input
      type="text"
      placeholder="Search foods..."
      class="w-full p-2 border border-gray-300 rounded"
      bind:value={searchQuery}
    />
  </div>

  {#if !filteredFoods}
    <p>Loading...</p>
  {:else if filteredFoods.length === 0}
    <p class="text-text-muted">No foods found.</p>
  {:else}
    <div class="grid gap-4">
      {#each filteredFoods as food (food.id)}
        <a href="#/foods/{food.id}" class="bg-card p-4 rounded-xl shadow-sm border border-border-subtle flex justify-between items-center hover:bg-surface transition-colors block cursor-pointer">
          <div>
            <h3 class="font-bold text-lg text-text-main">{food.name}</h3>
            {#if food.brand}
              <p class="text-sm text-text-muted">{food.brand}</p>
            {/if}
            <div class="text-sm text-text-muted mt-1">
              <span>{food.calories} kcal</span>
              <span class="mx-2">•</span>
              <span>P: {food.protein}g</span>
              <span class="mx-1">/</span>
              <span>C: {food.carbs}g</span>
              <span class="mx-1">/</span>
              <span>F: {food.fat}g</span>
            </div>
          </div>
          <div class="flex items-center space-x-2">
             {#if food.is_recipe}
                <span class="px-2 py-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 text-xs rounded-full">Recipe</span>
             {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
