import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ForkKnifeIcon as Utensils, CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, CalendarIcon as Calendar } from '@phosphor-icons/react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { db, type DailyLog, type Food } from '../lib/db';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement'] as const;

export default function DailyLogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // --- Date Logic ---
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const isToday = date === new Date().toISOString().split('T')[0];
  
  const displayDate = useMemo(() => 
    new Date(date).toLocaleDateString('en-US', { 
      weekday: 'short', month: 'short', day: 'numeric' 
    }), [date]
  );

  const changeDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    const newDate = d.toISOString().split('T')[0];
    setSearchParams({ date: newDate });
  };

  // --- Data Fetching (Dexie) ---
  const data = useLiveQuery(async () => {
    const daysLogs = await db.logs.where('date').equals(date).toArray();
    const foodIds = [...new Set(daysLogs.map(l => l.food_id))];
    const foods = await db.foods.where('id').anyOf(foodIds).toArray();
    const goal = await db.goals
      .where('start_date')
      .belowOrEqual(date)
      .reverse()
      .first();

    const foodsMap = foods.reduce((acc, food) => {
      acc[food.id] = food;
      return acc;
    }, {} as Record<string, Food>);

    return { daysLogs, foodsMap, goal };
  }, [date]);

  // --- Derived State (Calculations) ---
  const goals = {
    calories: data?.goal?.calories_target ?? 2000,
    protein: data?.goal?.protein_target ?? 150,
    carbs: data?.goal?.carbs_target ?? 200,
    fat: data?.goal?.fat_target ?? 65,
  };

  const extendedLogs = useMemo(() => {
    if (!data) return [];
    return data.daysLogs.map(log => {
      const food = data.foodsMap[log.food_id];
      if (!food) return { ...log, calories: 0, protein: 0, carbs: 0, fat: 0 };
      return {
        ...log,
        food,
        calories: Math.round(food.calories * log.amount_consumed),
        protein: Math.round(food.protein * log.amount_consumed),
        carbs: Math.round(food.carbs * log.amount_consumed),
        fat: Math.round(food.fat * log.amount_consumed)
      };
    });
  }, [data]);

  const dailyTotals = useMemo(() => 
    extendedLogs.reduce((acc, log) => ({
      calories: acc.calories + log.calories,
      protein: acc.protein + log.protein,
      carbs: acc.carbs + log.carbs,
      fat: acc.fat + log.fat
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), 
  [extendedLogs]);

  // --- Actions ---
  const deleteLog = async (id: string) => {
    if (window.confirm('Delete this entry?')) {
      await db.logs.delete(id);
    }
  };

  return (
    <div className="min-h-screen bg-page pb-20 font-sans">
      <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
        <div className="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold text-text-main">Daily Log</h1>
          
          <div className="flex items-center justify-between w-auto bg-surface rounded-full px-1 py-1 border border-border-subtle shadow-sm">
            <button 
              onClick={() => changeDate(-1)}
              className="p-2 hover:bg-card rounded-full transition-colors text-text-muted hover:text-text-main"
            >
              <ChevronLeft size={18} />
            </button>
            
            <div className="flex flex-col items-center px-4 cursor-pointer relative group">
              <input 
                type="date" 
                value={date} 
                onChange={(e) => setSearchParams({ date: e.target.value })}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
              />
              <span className="text-sm font-bold text-text-main leading-none flex items-center gap-1.5">
                <Calendar size={12} className="text-brand" />
                {isToday ? 'Today' : displayDate}
              </span>
              {!isToday && (
                <span className="text-[10px] text-text-muted leading-none mt-0.5">{displayDate}</span>
              )}
            </div>

            <button 
              onClick={() => changeDate(1)}
              className="p-2 hover:bg-card rounded-full transition-colors text-text-muted hover:text-text-main"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <Link to="/foods" className="text-text-muted hover:text-brand transition-colors p-2">
            <Utensils size={20} />
          </Link>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-6">
        {/* Summary Card */}
        <div className="bg-card rounded-2xl shadow-sm p-6 border border-border-subtle mb-8">
          <div className="flex justify-between items-end mb-2">
            <div>
              <p className="text-sm text-text-muted font-medium uppercase tracking-wide">Calories</p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-4xl font-extrabold text-text-main">{Math.round(dailyTotals.calories)}</span>
                <span className="text-sm text-text-muted font-medium">/ {goals.calories}</span>
              </div>
            </div>
            <div className="text-right mb-1">
              <p className="text-xs font-bold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 px-3 py-1 rounded-full inline-block">
                {Math.round(goals.calories - dailyTotals.calories)} LEFT
              </p>
            </div>
          </div>

          <div className="h-4 bg-surface rounded-full overflow-hidden mb-8 shadow-inner">
            <div 
              className="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-700 ease-out shadow-sm"
              style={{ width: `${Math.min((dailyTotals.calories / goals.calories) * 100, 100)}%` }}
            ></div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <MacroProgress label="Protein" current={dailyTotals.protein} target={goals.protein} color="bg-macro-protein" />
            <MacroProgress label="Carbs" current={dailyTotals.carbs} target={goals.carbs} color="bg-macro-carbs" />
            <MacroProgress label="Fat" current={dailyTotals.fat} target={goals.fat} color="bg-macro-fat" />
          </div>
        </div>

        {/* Meal Sections */}
        {MEAL_TYPES.map(meal => {
          const mealLogs = extendedLogs.filter(l => l.meal_type === meal);
          const mealCalories = mealLogs.reduce((sum, log) => sum + log.calories, 0);

          return (
            <div key={meal} className="mb-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-bold capitalize text-text-main">{meal}</h3>
                <span className="text-sm text-text-muted font-medium">{mealCalories} kcal</span>
              </div>
              
              <div className="space-y-3">
                {mealLogs.map(log => (
                  <div key={log.id} className="bg-card p-4 rounded-xl shadow-sm border border-border-subtle flex justify-between items-center">
                    <div>
                      <div className="font-medium text-text-main">
                        {log.food?.name || 'Unknown Food'}
                        <span className="text-xs text-text-muted font-normal ml-1">
                          ({log.food?.serving_unit && /^(g|ml|oz)$/i.test(log.food.serving_unit)
                            ? `${Math.round(log.amount_consumed * (log.food.serving_size || 100))}${log.food.serving_unit}`
                            : `${log.amount_consumed} ${log.food?.serving_unit || 'svg'}`})
                        </span>
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">
                        {log.calories} kcal • {log.protein}p • {log.carbs}c • {log.fat}f
                      </div>
                    </div>
                    <button 
                      onClick={() => deleteLog(log.id!)}
                      className="text-text-muted hover:text-red-500 p-2 transition-colors text-2xl"
                    >
                      &times;
                    </button>
                  </div>
                ))}

                <Link
                  to={`/log/add?date=${date}&meal=${meal}`}
                  className="block w-full text-center py-3 border-2 border-dashed border-border-subtle rounded-xl text-text-muted hover:border-brand hover:text-brand hover:bg-surface transition-all text-sm font-medium"
                >
                  + Add Food
                </Link>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}

// Sub-component for Cleaner Macros
function MacroProgress({ label, current, target, color }: { label: string, current: number, target: number, color: string }) {
  const percent = Math.min((current / target) * 100, 100);
  return (
    <div className="text-center">
      <p className="text-xs text-text-muted mb-2 font-medium">{label}</p>
      <div className="relative h-2 bg-surface rounded-full mb-2">
        <div 
          className={`absolute top-0 left-0 h-full ${color} rounded-full transition-all duration-500`} 
          style={{ width: `${percent}%` }}
        ></div>
      </div>
      <p className="text-xs font-bold text-text-main">
        {Math.round(current)} <span className="text-text-muted font-normal">/ {target}g</span>
      </p>
    </div>
  );
}