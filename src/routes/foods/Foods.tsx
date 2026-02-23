import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../lib/db';
import RouteHeader from '../../lib/components/RouteHeader';

export default function FoodList() {
  const [searchQuery, setSearchQuery] = useState('');

  // Subscribe to the foods table
  const foods = useLiveQuery(() => db.foods.toArray());

  // Reactive filtering using useMemo
  const filteredFoods = useMemo(() => {
    if (!foods) return [];
    
    const query = searchQuery.toLowerCase();
    return foods.filter(food => 
      food.name.toLowerCase().includes(query) ||
      (food.brand && food.brand.toLowerCase().includes(query))
    );
  }, [foods, searchQuery]);

  return (
    <div className="min-h-screen bg-page pb-24 font-sans">
      <RouteHeader
        title="Foods"
        rightAction={
          <div className="flex items-center gap-2">
            <Link
              to="/foods/new"
              className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-xs font-semibold text-text-main hover:border-brand-light"
            >
              Add Food
            </Link>
            <Link
              to="/foods/new-recipe"
              className="rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-xs font-semibold text-text-main hover:border-brand-light"
            >
              Create Recipe
            </Link>
          </div>
        }
      />

      <div className="max-w-md mx-auto p-4">

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

      {/* List Content */}
        {!foods ? (
          <p className="text-text-muted">Loading...</p>
        ) : filteredFoods.length === 0 ? (
          <p className="text-text-muted">No foods found.</p>
        ) : (
          <div className="grid gap-4">
            {filteredFoods.map((food) => (
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
    </div>
  );
}