import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, type Food } from '../../lib/db';
import { analyzeEaaRatio, scoreFoodForEaaDeficit, type EaaRatioGroupKey } from '../../lib/eaa';

export default function FoodList() {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'default' | 'eaa-gap'>('default');
  const today = new Date().toISOString().split('T')[0];

  // Subscribe to the foods table
  const foods = useLiveQuery(() => db.foods.toArray());
  const dayNutritionContext = useLiveQuery(async () => {
    const dayLogs = await db.logs.where('date').equals(today).toArray();
    const dayFoodIds = [...new Set(dayLogs.map((log) => log.food_id))];
    const dayFoods = dayFoodIds.length ? await db.foods.where('id').anyOf(dayFoodIds).toArray() : [];
    const dayFoodsMap = dayFoods.reduce<Record<string, Food>>((acc, food) => {
      acc[food.id] = food;
      return acc;
    }, {});

    return { dayLogs, dayFoodsMap };
  }, [today]);

  const eaaDeficit = useMemo(() => {
    if (!dayNutritionContext) {
      return {
        leucine: 0,
        lysine: 0,
        valineIsoleucine: 0,
        rest: 0
      };
    }

    return analyzeEaaRatio(
      dayNutritionContext.dayLogs.map((log) => {
        const food = dayNutritionContext.dayFoodsMap[log.food_id];
        return {
          proteinGrams: Number(food?.protein) || 0,
          amountConsumed: Number(log.amount_consumed) || 0,
          micros: food?.micros
        };
      })
    ).deficitByGroup;
  }, [dayNutritionContext]);

  // Reactive filtering using useMemo
  const rankedFoods = useMemo(() => {
    if (!foods) return [];
    
    const query = searchQuery.toLowerCase();
    const filtered = foods.filter(food => 
      food.name.toLowerCase().includes(query) ||
      (food.brand && food.brand.toLowerCase().includes(query))
    );

    if (sortMode === 'default') {
      return filtered.map((food) => ({
        food,
        score: 0,
        bestGroup: null as EaaRatioGroupKey | null
      }));
    }

    return [...filtered]
      .map((food) => {
        const scoreData = scoreFoodForEaaDeficit(food.micros, eaaDeficit, 1);
        const rankedGroups = (Object.keys(scoreData.filledByGroup) as EaaRatioGroupKey[])
          .map((group) => ({ group, value: scoreData.filledByGroup[group] }))
          .sort((a, b) => b.value - a.value);

        return {
          food,
          score: scoreData.score,
          bestGroup: rankedGroups[0]?.value > 0 ? rankedGroups[0].group : null
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.food.protein - a.food.protein;
      });
  }, [foods, searchQuery, sortMode, eaaDeficit]);

  return (
    <div className="container mx-auto p-4">
      {/* Header Section */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-text-main">Foods</h1>
        <div className="space-x-2">
          <Link 
            to="/foods/new" 
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors inline-block"
          >
            Add Food
          </Link>
          <Link 
            to="/foods/new-recipe" 
            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded transition-colors inline-block"
          >
            Create Recipe
          </Link>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search foods..."
          className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-text-muted">Sort by today&apos;s missing EAA groups</p>
        <div className="rounded-lg border border-border-subtle bg-surface p-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSortMode('default')}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${sortMode === 'default' ? 'bg-brand text-brand-fg' : 'text-text-muted hover:text-text-main'}`}
          >
            Default
          </button>
          <button
            type="button"
            onClick={() => setSortMode('eaa-gap')}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${sortMode === 'eaa-gap' ? 'bg-brand text-brand-fg' : 'text-text-muted hover:text-text-main'}`}
          >
            EAA Gap
          </button>
        </div>
      </div>

      {/* List Content */}
      {!foods ? (
        <p className="text-text-muted">Loading...</p>
      ) : rankedFoods.length === 0 ? (
        <p className="text-text-muted">No foods found.</p>
      ) : (
        <div className="grid gap-4">
          {rankedFoods.map(({ food, score, bestGroup }) => (
            <Link
              key={food.id}
              to={`/foods/${food.id}`}
              className="bg-card p-4 rounded-xl shadow-sm border border-border-subtle flex justify-between items-center hover:bg-surface transition-colors"
            >
              <div>
                <h3 className="font-bold text-lg text-text-main">{food.name}</h3>
                {food.brand && (
                  <p className="text-sm text-text-muted">{food.brand}</p>
                )}
                <div className="text-sm text-text-muted mt-1">
                  <span>{food.calories} kcal</span>
                  <span className="mx-2">•</span>
                  <span>P: {food.protein}g</span>
                  <span className="mx-1">/</span>
                  <span>C: {food.carbs}g</span>
                  <span className="mx-1">/</span>
                  <span>F: {food.fat}g</span>
                </div>
                {sortMode === 'eaa-gap' && (
                  <div className="text-xs text-text-muted mt-1">
                    {score > 0
                      ? `EAA fit +${(Math.round(score * 100) / 100).toFixed(2)}g${bestGroup ? ` (${bestGroup})` : ''}`
                      : 'No EAA gap contribution'}
                  </div>
                )}
              </div>
              
              <div className="flex items-center space-x-2">
                {food.is_recipe && (
                  <span className="px-2 py-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 text-xs rounded-full">
                    Recipe
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}