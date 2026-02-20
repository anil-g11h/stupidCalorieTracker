    import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Food } from '../../../lib/db';
import { generateId } from '../../../lib';
    import { analyzeEaaRatio, scoreFoodForEaaDeficit, type EaaRatioGroupKey } from '../../../lib/eaa';

const WEIGHT_BASED_REGEX = /^(g|ml|oz)$/i;

function formatServingLabel(food: Food): string {
  const unit = (food.serving_unit || '').trim();
  const size = food.serving_size;

  if (unit && size && Number.isFinite(size) && size > 0) {
    if (WEIGHT_BASED_REGEX.test(unit)) return `${size}${unit}`;
    return `${size} ${unit}`;
  }

  if (unit) {
    if (WEIGHT_BASED_REGEX.test(unit)) return `100${unit}`;
    return `1 ${unit}`;
  }

  return '1 serving';
}

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
  const [addedCount, setAddedCount] = useState(0);
  const [addedFoodIds, setAddedFoodIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<'default' | 'eaa-gap'>('default');

  const settingsRow = useLiveQuery(async () => db.settings.get('local-settings'), []);

  const mealLabel = useMemo(() => {
    const normalizedMealType = mealType.trim().toLowerCase();
    const meals = (settingsRow as any)?.meals;

    if (Array.isArray(meals)) {
      const matchedMeal = meals.find((meal: any) => {
        const id = String(meal?.id ?? '').trim().toLowerCase();
        const name = String(meal?.name ?? '').trim().toLowerCase();
        return id === normalizedMealType || name === normalizedMealType;
      });

      if (matchedMeal?.name) return String(matchedMeal.name);
    }

    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mealType);
    if (looksLikeUuid) return 'Meal';

    return mealType
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Meal';
  }, [mealType, settingsRow]);

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

  const dayNutritionContext = useLiveQuery(async () => {
    const dayLogs = await db.logs.where('date').equals(date).toArray();
    const dayFoodIds = [...new Set(dayLogs.map((log) => log.food_id))];
    const dayFoods = dayFoodIds.length ? await db.foods.where('id').anyOf(dayFoodIds).toArray() : [];
    const dayFoodsMap = dayFoods.reduce<Record<string, Food>>((acc, food) => {
      acc[food.id] = food;
      return acc;
    }, {});

    return { dayLogs, dayFoodsMap };
  }, [date]);

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

  const rankedSearchResults = useMemo(() => {
    if (!searchResults) return [];
    if (sortMode === 'default') {
      return searchResults.map((food) => ({
        food,
        score: 0,
        bestGroup: null as EaaRatioGroupKey | null
      }));
    }

    return [...searchResults]
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
  }, [searchResults, sortMode, eaaDeficit]);

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

  const saveLog = async (stayOnPage = false) => {
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
      
      if (logId) {
        await db.logs.put(entry);
        navigate(`/log?date=${date}`);
        return;
      }

      await db.logs.add(entry);

      if (stayOnPage) {
        setAddedCount((count) => count + 1);
        setAddedFoodIds((ids) => (ids.includes(selectedFood.id) ? ids : [...ids, selectedFood.id]));
        setSelectedFood(null);
        setInputValue(1);
        setSelectedUnit('serving');
        return;
      }

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
        <h1 className="text-2xl font-bold text-text-main">Add to {mealLabel}</h1>
        {!logId && (
          <button
            onClick={() => navigate(`/log?date=${date}`)}
            className="ml-auto px-3 py-1.5 rounded-full text-xs font-bold bg-brand text-brand-fg hover:opacity-90 transition-opacity"
          >
            Done{addedCount > 0 ? ` (${addedCount})` : ''}
          </button>
        )}
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
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] text-text-muted">Sort foods by daily EAA gap fill</p>
            <div className="rounded-lg border border-border-subtle bg-surface p-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSortMode('default')}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${sortMode === 'default' ? 'bg-brand text-brand-fg' : 'text-text-muted hover:text-text-main'}`}
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => setSortMode('eaa-gap')}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${sortMode === 'eaa-gap' ? 'bg-brand text-brand-fg' : 'text-text-muted hover:text-text-main'}`}
              >
                EAA Gap
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {rankedSearchResults?.map(({ food, score, bestGroup }) => {
              const alreadyAdded = addedFoodIds.includes(food.id);

              const bestGroupLabel =
                bestGroup === 'leucine'
                  ? 'Leucine'
                  : bestGroup === 'lysine'
                    ? 'Lysine'
                    : bestGroup === 'valineIsoleucine'
                      ? 'Val+Iso'
                      : bestGroup === 'rest'
                        ? 'Rest EAAs'
                        : null;

              return (
                <button
                  key={food.id}
                  onClick={() => handleSelectFood(food)}
                  className="w-full text-left p-4 bg-card border border-border-subtle rounded-lg shadow-sm hover:bg-surface transition-colors flex justify-between items-center"
                >
                  <div>
                    <div className="font-bold text-lg text-text-main">{food.name}</div>
                    <div className="text-sm text-text-muted">
                      {food.brand ? `${food.brand} • ` : ''}{food.calories} cal / {formatServingLabel(food)}
                    </div>
                    {sortMode === 'eaa-gap' && (
                      <div className="text-[11px] text-text-muted mt-1">
                        {score > 0
                          ? `EAA fit +${(Math.round(score * 100) / 100).toFixed(2)}g${bestGroupLabel ? ` (${bestGroupLabel})` : ''}`
                          : 'No EAA gap contribution'}
                      </div>
                    )}
                    <MacroContributionBar
                      protein={food.protein}
                      carbs={food.carbs}
                      fat={food.fat}
                    />
                  </div>
                  {alreadyAdded ? (
                    <div className="w-8 h-8 rounded-full bg-green-500 text-white text-lg font-black flex items-center justify-center">✓</div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-brand text-brand-fg text-2xl flex items-center justify-center">+</div>
                  )}
                </button>
              );
            }) || <div className="text-center text-text-muted mt-8 italic">Start typing to search...</div>}
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

          {logId ? (
            <button onClick={() => saveLog(false)} className="w-full bg-brand text-brand-fg py-4 rounded-xl text-lg font-bold shadow-lg hover:opacity-90 transition-opacity">
              Update Log
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => saveLog(true)}
                className="w-full bg-brand text-brand-fg py-4 rounded-xl text-base font-bold shadow-lg hover:opacity-90 transition-opacity"
              >
                Add & Continue
              </button>
              <button
                onClick={() => saveLog(false)}
                className="w-full bg-surface text-text-main py-4 rounded-xl text-base font-bold border border-border-subtle hover:bg-card transition-colors"
              >
                Add & Finish
              </button>
            </div>
          )}
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

const MacroContributionBar = ({
  protein,
  carbs,
  fat
}: {
  protein: number;
  carbs: number;
  fat: number;
}) => {
  const proteinKcal = Math.max(0, protein * 4);
  const carbsKcal = Math.max(0, carbs * 4);
  const fatKcal = Math.max(0, fat * 9);
  const totalKcal = Math.max(1, proteinKcal + carbsKcal + fatKcal);

  const proteinPct = (proteinKcal / totalKcal) * 100;
  const carbsPct = (carbsKcal / totalKcal) * 100;
  const fatPct = (fatKcal / totalKcal) * 100;

  return (
    <div className="mt-2 h-2 rounded-full overflow-hidden bg-surface border border-border-subtle flex w-40 max-w-full">
      <div className="bg-macro-protein" style={{ width: `${proteinPct}%` }} title={`${protein.toFixed(1)}p`} />
      <div className="bg-macro-carbs" style={{ width: `${carbsPct}%` }} title={`${carbs.toFixed(1)}c`} />
      <div className="bg-macro-fat" style={{ width: `${fatPct}%` }} title={`${fat.toFixed(1)}f`} />
    </div>
  );
};