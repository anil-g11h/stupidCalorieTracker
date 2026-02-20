import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, type Food } from '../../../lib/db';
import { calculateRecipeNutrition } from '../../../lib/recipes';
import { generateId } from '../../../lib';

interface SelectedIngredient {
  food: Food;
  quantity: number;
}

export default function CreateRecipe() {
  const navigate = useNavigate();

  // Basic Form State
  const [recipeName, setRecipeName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIngredients, setSelectedIngredients] = useState<SelectedIngredient[]>([]);
  
  // Search Modal State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Live Query for Search Results
  const searchResults = useLiveQuery(async () => {
    if (!searchQuery) return [];
    return await db.foods
      .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .limit(10)
      .toArray();
  }, [searchQuery]);

  // Derived State (Replaces $: declarations)
  const recipeStats = useMemo(() => 
    calculateRecipeNutrition(selectedIngredients), 
  [selectedIngredients]);

  // --- Actions ---
  const addIngredient = (food: Food) => {
    setSelectedIngredients(prev => [...prev, { food, quantity: 1 }]);
    setShowSearchModal(false);
    setSearchQuery('');
  };

  const removeIngredient = (index: number) => {
    setSelectedIngredients(prev => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, quantity: number) => {
    setSelectedIngredients(prev => prev.map((item, i) => 
      i === index ? { ...item, quantity: Math.max(0, quantity) } : item
    ));
  };

  const saveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeName) return alert('Please enter a recipe name');
    if (selectedIngredients.length === 0) return alert('Please add at least one ingredient');

    try {
      const recipeId = generateId();
      const now = new Date();
      const recipeFood: Food = {
        id: recipeId,
        name: recipeName,
        brand: 'Home Recipe',
        calories: recipeStats.calories,
        protein: recipeStats.protein,
        carbs: recipeStats.carbs,
        fat: recipeStats.fat,
        serving_size: recipeStats.weight,
        serving_unit: 'g',
        micros: {},
        is_recipe: true,
        created_at: now,
        updated_at: now,
        synced: 0,
        description,
        ingredients: selectedIngredients.map(i => ({ id: i.food.id, quantity: i.quantity }))
      };
      
      await db.foods.add(recipeFood);
      navigate('/foods');
    } catch (error) {
      console.error('Failed to save recipe:', error);
      alert('Failed to save recipe');
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Create New Recipe</h1>
      
      <form onSubmit={saveRecipe} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Recipe Name</label>
          <input 
            type="text" 
            required 
            value={recipeName} 
            onChange={(e) => setRecipeName(e.target.value)}
            className="w-full p-2 border rounded" 
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description (optional)</label>
          <textarea 
            value={description} 
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Ingredients</label>
          <button 
            type="button" 
            onClick={() => setShowSearchModal(true)}
            className="bg-blue-500 text-white px-3 py-1 rounded mb-2 block"
          >
            Add Ingredient
          </button>
          
          <ul className="mb-2 space-y-2">
            {selectedIngredients.map((ing, i) => (
              <li key={`${ing.food.id}-${i}`} className="flex items-center justify-between bg-surface p-2 rounded border border-border-subtle">
                <div className="flex flex-col">
                  <span className="font-medium">{ing.food.name}</span>
                  <span className="text-xs text-text-muted">
                    Unit: {ing.food.serving_size}{ing.food.serving_unit}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    value={ing.quantity}
                    onChange={(e) => updateQuantity(i, Number(e.target.value))}
                    className="w-16 p-1 border rounded text-center"
                  />
                  <button 
                    type="button" 
                    onClick={() => removeIngredient(i)}
                    className="text-red-500 text-xl px-2"
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Nutrition Summary */}
        <div className="grid grid-cols-2 gap-4 bg-card p-4 rounded-xl border border-border-subtle">
          <NutrientField label="Total Calories" value={recipeStats.calories} />
          <NutrientField label="Total Protein (g)" value={recipeStats.protein} />
          <NutrientField label="Total Carbs (g)" value={recipeStats.carbs} />
          <NutrientField label="Total Fat (g)" value={recipeStats.fat} />
        </div>

        <button 
          type="submit" 
          className="w-full bg-green-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-green-700 transition shadow-sm mt-4"
        >
          Save Recipe
        </button>
      </form>

      {/* Search Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Add Ingredient</h2>
            <input 
              type="text" 
              autoFocus
              placeholder="Search foods..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full p-2 border rounded mb-4" 
            />
            
            <div className="max-h-64 overflow-y-auto border rounded divide-y">
              {searchResults?.length ? (
                searchResults.map(food => (
                  <div 
                    key={food.id}
                    onClick={() => addIngredient(food)}
                    className="p-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors"
                  >
                    <span>{food.name}</span>
                    <span className="text-xs text-text-muted">{food.brand}</span>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-gray-500 italic">
                  {searchQuery ? 'No foods found' : 'Type to search foods...'}
                </div>
              )}
            </div>
            
            <button 
              className="mt-6 w-full py-2 bg-gray-100 rounded font-medium hover:bg-gray-200" 
              onClick={() => setShowSearchModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple internal component for read-only fields
function NutrientField({ label, value }: { label: string, value: number }) {
  return (
    <div>
      <label className="block text-xs font-bold text-text-muted uppercase mb-1">{label}</label>
      <input 
        type="number" 
        value={Math.round(value)} 
        readOnly 
        className="w-full p-2 border rounded bg-gray-50 font-mono" 
      />
    </div>
  );
}