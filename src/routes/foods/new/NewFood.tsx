import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../../lib/db';

export default function CreateFood() {
  const navigate = useNavigate();

  // Form State
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [calories, setCalories] = useState(0);
  const [protein, setProtein] = useState(0);
  const [carbs, setCarbs] = useState(0);
  const [fat, setFat] = useState(0);
  const [servingSize, setServingSize] = useState(100);
  const [servingUnit, setServingUnit] = useState('g');
  const [micros] = useState<Record<string, number>>({});

  // Reactive Calories Calculation
  // In React, we use useEffect to sync state based on other state changes
  useEffect(() => {
    const calculated = Math.round((protein * 4) + (carbs * 4) + (fat * 9));
    setCalories(calculated);
  }, [protein, carbs, fat]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await db.foods.add({
        id: crypto.randomUUID(),
        name,
        brand: brand || undefined,
        calories,
        protein,
        carbs,
        fat,
        serving_size: servingSize,
        serving_unit: servingUnit,
        micros,
        is_recipe: false,
        created_at: new Date(),
        updated_at: new Date(),
        synced: 0
      });
      navigate('/foods');
    } catch (error) {
      console.error('Failed to create food:', error);
      alert('Failed to create food');
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Create New Food</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="food-name" className="block text-sm font-medium mb-1">Name</label>
          <input 
            id="food-name" 
            type="text" 
            required 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            className="w-full p-2 border rounded" 
          />
        </div>

        <div>
          <label htmlFor="food-brand" className="block text-sm font-medium mb-1">Brand (Optional)</label>
          <input 
            id="food-brand" 
            type="text" 
            value={brand} 
            onChange={(e) => setBrand(e.target.value)} 
            className="w-full p-2 border rounded" 
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="serving-size" className="block text-sm font-medium mb-1">Serving Size</label>
            <input 
              id="serving-size" 
              type="number" 
              step="any" 
              value={servingSize} 
              onChange={(e) => setServingSize(Number(e.target.value))} 
              className="w-full p-2 border rounded" 
            />
          </div>
          <div>
            <label htmlFor="serving-unit" className="block text-sm font-medium mb-1">Unit</label>
            <input 
              id="serving-unit" 
              type="text" 
              value={servingUnit} 
              onChange={(e) => setServingUnit(e.target.value)} 
              className="w-full p-2 border rounded" 
              placeholder="g, ml, oz" 
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="calories" className="block text-sm font-medium mb-1">Calories (kcal)</label>
            <input 
              id="calories" 
              type="number" 
              step="any" 
              required 
              value={calories} 
              onChange={(e) => setCalories(Number(e.target.value))} 
              className="w-full p-2 border rounded bg-gray-50" 
            />
          </div>
          <div>
            <label htmlFor="protein" className="block text-sm font-medium mb-1">Protein (g)</label>
            <input 
              id="protein" 
              type="number" 
              step="any" 
              required 
              value={protein} 
              onChange={(e) => setProtein(Number(e.target.value))} 
              className="w-full p-2 border rounded" 
            />
          </div>
          <div>
            <label htmlFor="carbs" className="block text-sm font-medium mb-1">Carbs (g)</label>
            <input 
              id="carbs" 
              type="number" 
              step="any" 
              required 
              value={carbs} 
              onChange={(e) => setCarbs(Number(e.target.value))} 
              className="w-full p-2 border rounded" 
            />
          </div>
          <div>
            <label htmlFor="fat" className="block text-sm font-medium mb-1">Fat (g)</label>
            <input 
              id="fat" 
              type="number" 
              step="any" 
              required 
              value={fat} 
              onChange={(e) => setFat(Number(e.target.value))} 
              className="w-full p-2 border rounded" 
            />
          </div>
        </div>

        <button 
          type="submit" 
          className="w-full bg-blue-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition shadow-sm mt-2"
        >
          Save Food
        </button>
      </form>
    </div>
  );
}