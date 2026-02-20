    import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Food } from '../../../lib/db';
import { generateId } from '../../../lib';

const WEIGHT_BASED_REGEX = /^(g|ml|oz)$/i;

export default function AddLogEntry() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // --- Route Params ---
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const mealType = searchParams.get('meal') || 'breakfast';
  const logId = searchParams.get('log_id');

  // --- State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [inputValue, setInputValue] = useState(1);
  const [selectedUnit, setSelectedUnit] = useState('serving');

  // --- Dexie Queries ---
  // 1. Initial Load for Editing
  useEffect(() => {
    async function loadExistingLog() {
      if (logId) {
        const log = await db.logs.get(logId);
        if (log) {
          const food = await db.foods.get(log.food_id);
          if (food) {
            setSelectedFood(food);
            const isWeight = food.serving_unit && WEIGHT_BASED_REGEX.test(food.serving_unit);
            if (isWeight) {
              setSelectedUnit(food.serving_unit!);
              setInputValue(Math.round(log.amount_consumed * (food.serving_size || 100)));
            } else {
              setSelectedUnit('serving');
              setInputValue(log.amount_consumed);
            }
          }
        }
      }
    }
    loadExistingLog();
  }, [logId]);

  // 2. Live Search
  const searchResults = useLiveQuery(async () => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length > 0) {
      return await db.foods
        .filter(f => f.name.toLowerCase().includes(query))
        .limit(20)
        .toArray();
    }
    return await db.foods.limit(20).toArray();
  }, [searchQuery]);

  // --- Calculations (Derived State) ---
  const isWeightBased = useMemo(() => 
    !!(selectedFood?.serving_unit && WEIGHT_BASED_REGEX.test(selectedFood.serving_unit)), 
    [selectedFood]
  );

  const quantity = useMemo(() => {
    if (!selectedFood) return 1;
    if (selectedUnit === 'serving') return inputValue;
    const size = selectedFood.serving_size || 1;
    return size > 0 ? inputValue / size : inputValue;
  }, [inputValue, selectedUnit, selectedFood]);

  const stats = useMemo(() => ({
    calories: selectedFood ? (selectedFood.calories * quantity).toFixed(0) : 0,
    protein: selectedFood ? (selectedFood.protein * quantity).toFixed(1) : 0,
    carbs: selectedFood ? (selectedFood.carbs * quantity).toFixed(1) : 0,
    fat: selectedFood ? (selectedFood.fat * quantity).toFixed(1) : 0,
  }), [selectedFood, quantity]);

  // --- Handlers ---
  const handleSelectFood = (food: Food) => {
    setSelectedFood(food);
    const isWeight = food.serving_unit && WEIGHT_BASED_REGEX.test(food.serving_unit);
    if (isWeight) {
      setSelectedUnit(food.serving_unit!);
      setInputValue(food.serving_size || 100);
    } else {
      setSelectedUnit('serving');
      setInputValue(1);
    }
  };

  const updateUnit = (newUnit: string) => {
    if (!selectedFood) return;
    const servingSize = selectedFood.serving_size || 1;
    
    if (newUnit === 'serving' && selectedUnit !== 'serving') {
      setInputValue(prev => parseFloat((prev / servingSize).toFixed(2)));
    } else if (newUnit !== 'serving' && selectedUnit === 'serving') {
      setInputValue(prev => parseFloat((prev * servingSize).toFixed(1)));
    }
    setSelectedUnit(newUnit);
  };

  const saveLog = async () => {
    if (!selectedFood) return;
    try {
      const entry = {
        id: logId || generateId(), // If logId exists, we update, else create
        user_id: 'local-user',
        date,
        meal_type: mealType,
        food_id: selectedFood.id,
        amount_consumed: quantity,
        synced: 0,
        created_at: new Date()
      };
      
      logId ? await db.logs.put(entry) : await db.logs.add(entry);
      navigate(`/log?date=${date}`);
    } catch (error) {
      console.error('Failed to save log:', error);
      alert('Failed to save log');
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-md pb-24">
      <div className="flex items-center mb-4">
        <Link to={`/log?date=${date}`} className="mr-4 text-text-muted hover:text-text-main">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold capitalize text-text-main">Add to {mealType}</h1>
      </div>

      {!selectedFood ? (
        <>
          <div className="mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search foods..."
              className="w-full p-3 bg-surface text-text-main border border-transparent rounded-lg shadow-sm focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            {searchResults?.map(food => (
              <button
                key={food.id}
                onClick={() => handleSelectFood(food)}
                className="w-full text-left p-4 bg-card border border-border-subtle rounded-lg shadow-sm hover:bg-surface transition-colors flex justify-between items-center"
              >
                <div>
                  <div className="font-bold text-lg text-text-main">{food.name}</div>
                  <div className="text-sm text-text-muted">
                    {food.brand ? `${food.brand} • ` : ''}{food.calories} cal
                  </div>
                </div>
                <div className="text-brand text-2xl">+</div>
              </button>
            )) || <div className="text-center text-text-muted mt-8 italic">Start typing to search...</div>}
          </div>
        </>
      ) : (
        <div className="bg-card rounded-xl shadow-lg p-6 border border-border-subtle">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-2xl font-bold text-text-main">{selectedFood.name}</h2>
              {selectedFood.brand && <p className="text-text-muted">{selectedFood.brand}</p>}
            </div>
            <button onClick={() => setSelectedFood(null)} className="text-text-muted hover:text-text-main">
              Close
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 mb-6 text-center">
            <StatBox value={stats.calories} label="Cal" />
            <StatBox value={`${stats.protein}g`} label="Prot" color="text-macro-protein" />
            <StatBox value={`${stats.carbs}g`} label="Carb" color="text-macro-carbs" />
            <StatBox value={`${stats.fat}g`} label="Fat" color="text-macro-fat" />
          </div>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="block text-sm font-medium text-text-muted">Quantity</span>
              {isWeightBased && (
                <div className="flex items-center space-x-2 bg-surface rounded-lg p-1">
                  <UnitBtn active={selectedUnit === 'serving'} onClick={() => updateUnit('serving')}>Serving</UnitBtn>
                  <UnitBtn active={selectedUnit !== 'serving'} onClick={() => updateUnit(selectedFood.serving_unit!)}>
                    {selectedFood.serving_unit}
                  </UnitBtn>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-4">
              <StepperBtn onClick={() => {
                const step = selectedUnit === 'serving' ? 0.25 : 10;
                setInputValue(v => Math.max(step, selectedUnit !== 'serving' ? Math.round(v - step) : v - step));
              }}>-</StepperBtn>
              
              <div className="flex-1 relative">
                <input 
                  type="number" 
                  value={inputValue} 
                  onChange={(e) => setInputValue(Number(e.target.value))}
                  className="w-full p-3 text-center border bg-surface text-text-main border-transparent rounded-lg text-lg font-bold"
                />
                {!isWeightBased && (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted text-sm font-medium">
                    {selectedFood.serving_unit || 'svg'}
                  </span>
                )}
              </div>

              <StepperBtn onClick={() => {
                const step = selectedUnit === 'serving' ? 0.25 : 10;
                setInputValue(v => selectedUnit !== 'serving' ? Math.round(v + step) : v + step);
              }}>+</StepperBtn>
            </div>
          </div>

          <button onClick={saveLog} className="w-full bg-brand text-brand-fg py-4 rounded-xl text-lg font-bold shadow-lg hover:opacity-90 transition-opacity">
            {logId ? 'Update Log' : 'Add to Log'}
          </button>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---
const StatBox = ({ value, label, color = "text-text-main" }: any) => (
  <div className="bg-surface p-2 rounded">
    <div className={`text-xl font-bold ${color}`}>{value}</div>
    <div className="text-xs text-text-muted">{label}</div>
  </div>
);

const UnitBtn = ({ active, onClick, children }: any) => (
  <button 
    onClick={onClick}
    className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${active ? 'bg-brand text-brand-fg shadow-sm' : 'text-text-muted hover:text-text-main'}`}
  >
    {children}
  </button>
);

const StepperBtn = ({ onClick, children }: any) => (
  <button 
    onClick={onClick}
    className="w-12 h-12 rounded-full bg-surface text-text-main text-xl font-bold flex items-center justify-center hover:bg-border-subtle transition-colors"
  >
    {children}
  </button>
);