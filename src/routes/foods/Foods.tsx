import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../lib/db';
import { useStackNavigation } from '../../lib/useStackNavigation';

export default function FoodList() {
  const { pop } = useStackNavigation();
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
    <div className="container mx-auto p-4">
      {/* Header Section */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => pop('/')}
            className="text-text-muted hover:text-text-main transition-colors"
            aria-label="Back"
          >
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold text-text-main">Foods</h1>
        </div>
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
  );
}