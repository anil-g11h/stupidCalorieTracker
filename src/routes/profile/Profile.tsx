import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BodyMetric, type Goal } from '../../lib/db';
import { supabase } from '../../lib/supabaseClient';
import { generateId } from '../../lib';
import Auth from '../../lib/components/Auth';

type MealTargetMode = 'percent' | 'calories';
type ReminderKey = 'food' | 'water' | 'workout' | 'walk' | 'weight' | 'medicine';

interface MealSetting {
  id: string;
  name: string;
  time: string;
  targetMode: MealTargetMode;
  targetValue: number;
}

interface ReminderSetting {
  enabled: boolean;
  time: string;
}

interface LocalSettingsRow {
  id: 'local-settings';
  user_id?: string | null;
  nutrition: {
    calorieBudget: number;
    proteinPercent: number;
    carbPercent: number;
    fatPercent: number;
    fiberGrams: number;
  };
  meals: MealSetting[];
  reminders: Record<ReminderKey, ReminderSetting>;
  updated_at: string;
}

const SETTINGS_STORAGE_KEY = 'stupid_tracker_settings_v1';
const SETTINGS_ID: LocalSettingsRow['id'] = 'local-settings';
const REMINDER_KEYS: ReminderKey[] = ['food', 'water', 'workout', 'walk', 'weight', 'medicine'];
const TODAY = () => new Date().toISOString().split('T')[0];

const createDefaultSettings = (): LocalSettingsRow => ({
  id: SETTINGS_ID,
  nutrition: {
    calorieBudget: 2000,
    proteinPercent: 30,
    carbPercent: 40,
    fatPercent: 30,
    fiberGrams: 30
  },
  meals: [
    { id: generateId(), name: 'Breakfast', time: '08:00', targetMode: 'percent', targetValue: 25 },
    { id: generateId(), name: 'Lunch', time: '13:00', targetMode: 'percent', targetValue: 35 },
    { id: generateId(), name: 'Dinner', time: '19:00', targetMode: 'percent', targetValue: 30 },
    { id: generateId(), name: 'Snack', time: '16:00', targetMode: 'percent', targetValue: 10 }
  ],
  reminders: {
    food: { enabled: true, time: '08:00' },
    water: { enabled: true, time: '10:00' },
    workout: { enabled: false, time: '18:00' },
    walk: { enabled: false, time: '17:00' },
    weight: { enabled: false, time: '07:00' },
    medicine: { enabled: false, time: '09:00' }
  },
  updated_at: new Date().toISOString()
});

const toNonNegativeNumber = (value: number, fallback = 0) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

const round1 = (value: number) => Math.round(value * 10) / 10;

const normalizeSettings = (input: Partial<LocalSettingsRow> | null | undefined): LocalSettingsRow => {
  const defaults = createDefaultSettings();
  const nutrition = input?.nutrition ?? defaults.nutrition;
  const remindersInput = input?.reminders ?? defaults.reminders;

  const reminders = REMINDER_KEYS.reduce((acc, key) => {
    const item = remindersInput[key] ?? defaults.reminders[key];
    acc[key] = {
      enabled: Boolean(item?.enabled),
      time: item?.time || defaults.reminders[key].time
    };
    return acc;
  }, {} as Record<ReminderKey, ReminderSetting>);

  const meals: MealSetting[] = (input?.meals ?? defaults.meals).map((meal, index) => ({
    id: meal.id || generateId(),
    name: (meal.name || `Meal ${index + 1}`).trim(),
    time: meal.time || '12:00',
    targetMode: meal.targetMode === 'calories' ? 'calories' : 'percent',
    targetValue: toNonNegativeNumber(Number(meal.targetValue), 0)
  }));

  return {
    id: SETTINGS_ID,
    user_id: input?.user_id ?? null,
    nutrition: {
      calorieBudget: toNonNegativeNumber(Number(nutrition.calorieBudget), defaults.nutrition.calorieBudget),
      proteinPercent: toNonNegativeNumber(Number(nutrition.proteinPercent), defaults.nutrition.proteinPercent),
      carbPercent: toNonNegativeNumber(Number(nutrition.carbPercent), defaults.nutrition.carbPercent),
      fatPercent: toNonNegativeNumber(Number(nutrition.fatPercent), defaults.nutrition.fatPercent),
      fiberGrams: toNonNegativeNumber(Number(nutrition.fiberGrams), defaults.nutrition.fiberGrams)
    },
    meals,
    reminders,
    updated_at: input?.updated_at || new Date().toISOString()
  };
};

const loadSettingsFromStorage = (): LocalSettingsRow => {
  if (typeof window === 'undefined') return createDefaultSettings();

  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return createDefaultSettings();
    const parsed = JSON.parse(raw) as Partial<LocalSettingsRow>;
    return normalizeSettings(parsed);
  } catch {
    return createDefaultSettings();
  }
};

export default function ProfileSettings() {
  const [openSection, setOpenSection] = useState<'nutrition' | 'meals' | 'reminders' | 'weight' | null>(null);
  const [mealInputMode, setMealInputMode] = useState<MealTargetMode>('percent');
  const [draggingMacroHandle, setDraggingMacroHandle] = useState<'first' | 'second' | null>(null);
  const macroTrackRef = useRef<HTMLDivElement | null>(null);
  const settingsTable = db.table<LocalSettingsRow, string>('settings');
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<LocalSettingsRow>(createDefaultSettings());

  const [weightForm, setWeightForm] = useState({
    date: TODAY(),
    value: '',
    unit: 'kg'
  });

  const recentWeight = useLiveQuery(
    async () => {
      const userId = session?.user?.id ?? 'local-user';
      const list = await db.metrics
        .where('type')
        .equals('weight')
        .and((row) => row.user_id === userId)
        .toArray();

      return list
        .sort((a, b) => {
          if (a.date === b.date) return (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0);
          return a.date < b.date ? 1 : -1;
        })
        .slice(0, 7);
    },
    [session?.user?.id],
    [] as BodyMetric[]
  );

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const fromDb = await settingsTable.get(SETTINGS_ID);
        if (fromDb) {
          const normalized = normalizeSettings(fromDb);
          setForm(normalized);
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
          return;
        }
      } catch (error) {
        console.error('Failed to read settings from IndexedDB', error);
      }

      const fromStorage = loadSettingsFromStorage();
      setForm(fromStorage);

      try {
        await settingsTable.put(fromStorage);
      } catch (error) {
        console.error('Failed to seed settings into IndexedDB', error);
      }
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: activeSession } }) => {
      setSession(activeSession);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, activeSession) => {
      setSession(activeSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  const macroSum = useMemo(
    () =>
      toNonNegativeNumber(form.nutrition.proteinPercent) +
      toNonNegativeNumber(form.nutrition.carbPercent) +
      toNonNegativeNumber(form.nutrition.fatPercent),
    [form.nutrition.proteinPercent, form.nutrition.carbPercent, form.nutrition.fatPercent]
  );
  const macroFirstCut = Math.min(100, Math.max(0, Math.round(toNonNegativeNumber(form.nutrition.proteinPercent, 0))));
  const macroSecondCut = Math.min(
    100,
    Math.max(macroFirstCut, Math.round(toNonNegativeNumber(form.nutrition.proteinPercent + form.nutrition.carbPercent, 0)))
  );

  const dailyCalorieBudget = toNonNegativeNumber(form.nutrition.calorieBudget, 0);
  const proteinGramsDisplay = Math.floor((dailyCalorieBudget * (toNonNegativeNumber(form.nutrition.proteinPercent, 0) / 100)) / 4);
  const carbGramsDisplay = Math.floor((dailyCalorieBudget * (toNonNegativeNumber(form.nutrition.carbPercent, 0) / 100)) / 4);
  const fatGramsDisplay = Math.floor((dailyCalorieBudget * (toNonNegativeNumber(form.nutrition.fatPercent, 0) / 100)) / 9);
  const totalMealPercent = useMemo(
    () => form.meals.reduce((sum, meal) => sum + toNonNegativeNumber(meal.targetValue, 0), 0),
    [form.meals]
  );

  const totalMealCalories = useMemo(
    () => (totalMealPercent / 100) * dailyCalorieBudget,
    [totalMealPercent, dailyCalorieBudget]
  );

  const isMealPercentValid = Math.abs(totalMealPercent - 100) < 0.05;
  const isMealCaloriesValid = Math.abs(totalMealCalories - dailyCalorieBudget) < 0.5;
  const canSaveSettings = isMealPercentValid && isMealCaloriesValid;

  const updateNutrition = (patch: Partial<LocalSettingsRow['nutrition']>) => {
    setForm((prev) => ({
      ...prev,
      nutrition: { ...prev.nutrition, ...patch }
    }));
  };

  const setMacroCuts = (firstCut: number, secondCut: number) => {
    const normalizedFirst = Math.min(100, Math.max(0, Math.round(firstCut)));
    const normalizedSecond = Math.min(100, Math.max(normalizedFirst, Math.round(secondCut)));

    setForm((prev) => ({
      ...prev,
      nutrition: {
        ...prev.nutrition,
        proteinPercent: normalizedFirst,
        carbPercent: normalizedSecond - normalizedFirst,
        fatPercent: 100 - normalizedSecond
      }
    }));
  };

  useEffect(() => {
    if (!draggingMacroHandle) return;

    const onMouseMove = (event: MouseEvent) => {
      if (!macroTrackRef.current) return;
      const rect = macroTrackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;

      const rawPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const clampedPercent = Math.min(100, Math.max(0, rawPercent));

      if (draggingMacroHandle === 'first') {
        setMacroCuts(clampedPercent, macroSecondCut);
      } else {
        setMacroCuts(macroFirstCut, clampedPercent);
      }
    };

    const onMouseUp = () => setDraggingMacroHandle(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [draggingMacroHandle, macroFirstCut, macroSecondCut]);

  const addMeal = () => {
    setForm((prev) => ({
      ...prev,
      meals: [
        ...prev.meals,
        {
          id: generateId(),
          name: `Meal ${prev.meals.length + 1}`,
          time: '12:00',
          targetMode: 'percent',
          targetValue: 20
        }
      ]
    }));
  };

  const updateMeal = (mealId: string, patch: Partial<MealSetting>) => {
    setForm((prev) => ({
      ...prev,
      meals: prev.meals.map((meal) => (meal.id === mealId ? { ...meal, ...patch } : meal))
    }));
  };

  const removeMeal = (mealId: string) => {
    setForm((prev) => ({
      ...prev,
      meals: prev.meals.filter((meal) => meal.id !== mealId)
    }));
  };

  const updateReminder = (key: ReminderKey, patch: Partial<ReminderSetting>) => {
    setForm((prev) => ({
      ...prev,
      reminders: {
        ...prev.reminders,
        [key]: { ...prev.reminders[key], ...patch }
      }
    }));
  };

  const saveAllSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    try {
      const normalized = normalizeSettings({
        ...form,
        user_id: session?.user?.id ?? form.user_id ?? null,
        updated_at: new Date().toISOString()
      });

      await settingsTable.put(normalized);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
      setForm(normalized);

      const calories = normalized.nutrition.calorieBudget;
      const proteinGrams = round1((calories * (normalized.nutrition.proteinPercent / 100)) / 4);
      const carbGrams = round1((calories * (normalized.nutrition.carbPercent / 100)) / 4);
      const fatGrams = round1((calories * (normalized.nutrition.fatPercent / 100)) / 9);

      const today = TODAY();
      const userId = session?.user?.id ?? 'local-user';

      const existingTodayGoal = await db.goals
        .where('start_date')
        .equals(today)
        .and((goal) => goal.user_id === userId)
        .first();

      const upsertGoal: Goal = {
        id: existingTodayGoal?.id ?? generateId(),
        user_id: userId,
        start_date: today,
        calories_target: calories,
        protein_target: proteinGrams,
        carbs_target: carbGrams,
        fat_target: fatGrams,
        sleep_target: existingTodayGoal?.sleep_target,
        water_target: existingTodayGoal?.water_target,
        weight_target: existingTodayGoal?.weight_target,
        synced: 0,
        created_at: existingTodayGoal?.created_at ?? new Date()
      };

      await db.goals.put(upsertGoal);
      alert('Settings saved');
    } catch (error) {
      console.error(error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const addWeight = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(weightForm.value);

    if (!Number.isFinite(value) || value <= 0) {
      alert('Enter a valid weight');
      return;
    }

    try {
      const metric: BodyMetric = {
        id: generateId(),
        user_id: session?.user?.id ?? 'local-user',
        date: weightForm.date || TODAY(),
        type: 'weight',
        value: round1(value),
        unit: weightForm.unit,
        synced: 0,
        created_at: new Date()
      };

      await db.metrics.put(metric);
      setWeightForm((prev) => ({ ...prev, value: '' }));
    } catch (error) {
      console.error(error);
      alert('Failed to add weight');
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-text-muted">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-page pb-24">
        <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
          <div className="max-w-md mx-auto px-4 py-3">
            <h1 className="text-xl font-bold text-text-main">Profile</h1>
          </div>
        </header>
        <div className="px-4 max-w-md mx-auto mt-8">
          <div className="bg-card p-5 rounded-2xl border border-border-subtle">
            <h2 className="text-base font-bold text-text-main mb-3">Sign in</h2>
            <Auth />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page pb-24">
      <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-text-main">Profile Settings</h1>
          <button
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-surface text-text-muted hover:text-text-main border border-border-subtle transition-colors"
            onClick={() => supabase.auth.signOut()}
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-5">
        <form onSubmit={saveAllSettings} className="space-y-5">
          <OptionCard
            title="Nutrition Settings"
            subtitle="Daily budget, macro split, and fiber target"
            isOpen={openSection === 'nutrition'}
            onToggle={() => setOpenSection((prev) => (prev === 'nutrition' ? null : 'nutrition'))}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Calorie budget (kcal)">
                <input
                  type="number"
                  min="0"
                  value={form.nutrition.calorieBudget}
                  onChange={(e) => updateNutrition({ calorieBudget: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
                />
              </Field>

              <Field label="Fiber (g)">
                <input
                  type="number"
                  min="0"
                  value={form.nutrition.fiberGrams}
                  onChange={(e) => updateNutrition({ fiberGrams: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
                />
              </Field>

              <div className="col-span-2 bg-surface border border-border-subtle rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-macro-protein/35 bg-macro-protein/15 py-1">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Protein</div>
                    <div className="text-sm font-bold text-text-main">{proteinGramsDisplay}g</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Carbs</div>
                    <div className="text-sm font-bold text-text-main">{carbGramsDisplay}g</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Fat</div>
                    <div className="text-sm font-bold text-text-main">{fatGramsDisplay}g</div>
                  </div>
                </div>

                <div
                  ref={macroTrackRef}
                  className="relative h-10 select-none"
                  onMouseDown={(e) => {
                    if (!macroTrackRef.current) return;
                    const rect = macroTrackRef.current.getBoundingClientRect();
                    const clickPercent = ((e.clientX - rect.left) / rect.width) * 100;
                    const distToFirst = Math.abs(clickPercent - macroFirstCut);
                    const distToSecond = Math.abs(clickPercent - macroSecondCut);
                    setDraggingMacroHandle(distToFirst <= distToSecond ? 'first' : 'second');
                  }}
                >
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-6 rounded-full overflow-hidden border border-border-subtle flex">
                    <div className="h-full bg-brand flex items-center justify-center" style={{ width: `${macroFirstCut}%` }}>
                      <span className="text-[10px] font-bold text-brand-fg whitespace-nowrap">{form.nutrition.proteinPercent}%</span>
                    </div>
                    <div className="h-full bg-surface flex items-center justify-center" style={{ width: `${macroSecondCut - macroFirstCut}%` }}>
                      <span className="text-[10px] font-bold text-text-main whitespace-nowrap">{form.nutrition.carbPercent}%</span>
                    </div>
                    <div className="h-full bg-macro-fat flex items-center justify-center" style={{ width: `${100 - macroSecondCut}%` }}>
                      <span className="text-[10px] font-bold text-white whitespace-nowrap">{form.nutrition.fatPercent}%</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingMacroHandle('first');
                    }}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full border border-border-subtle bg-card shadow-sm"
                    style={{ left: `${macroFirstCut}%` }}
                    aria-label="Adjust protein/carbs split"
                  />

                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingMacroHandle('second');
                    }}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full border border-border-subtle bg-card shadow-sm"
                    style={{ left: `${macroSecondCut}%` }}
                    aria-label="Adjust carbs/fat split"
                  />
                </div>
              </div>

              <div className="col-span-2 text-xs text-text-muted">
                Macro total:{' '}
                <span className={macroSum === 100 ? 'text-text-main font-bold' : 'text-text-main'}>{macroSum}%</span>
              </div>
            </div>
          </OptionCard>

          <OptionCard
            title="Meals"
            subtitle="Name, time, and target split per meal"
            isOpen={openSection === 'meals'}
            onToggle={() => setOpenSection((prev) => (prev === 'meals' ? null : 'meals'))}
          >
            <div className="space-y-4">
              <button
                type="button"
                onClick={addMeal}
                className="px-3 py-1.5 rounded-full text-xs font-bold bg-surface text-text-muted hover:text-text-main border border-border-subtle transition-colors"
              >
                Add Meal
              </button>

              <div className="space-y-3">
                {form.meals.length === 0 ? (
                  <div className="text-center py-6 bg-surface rounded-xl border border-border-subtle">
                    <p className="text-sm text-text-muted">No meals configured.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[minmax(0,1fr)_72px_84px] gap-2 px-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Meal</span>
                      <div className="col-span-2 h-6 rounded-lg border border-border-subtle bg-surface relative overflow-hidden">
                        <div
                          className={`absolute top-0 bottom-0 w-1/2 rounded-md bg-brand transition-transform ${
                            mealInputMode === 'calories' ? 'translate-x-full' : 'translate-x-0'
                          }`}
                        />
                        <div className="relative z-10 grid grid-cols-2 h-full">
                          <button
                            type="button"
                            onClick={() => setMealInputMode('percent')}
                            className={`text-[10px] font-bold uppercase tracking-wide ${
                              mealInputMode === 'percent' ? 'text-brand-fg' : 'text-text-muted'
                            }`}
                          >
                            % Target
                          </button>
                          <button
                            type="button"
                            onClick={() => setMealInputMode('calories')}
                            className={`text-[10px] font-bold uppercase tracking-wide ${
                              mealInputMode === 'calories' ? 'text-brand-fg' : 'text-text-muted'
                            }`}
                          >
                            Calories
                          </button>
                        </div>
                      </div>
                    </div>

                    {form.meals.map((meal) => (
                      <div key={meal.id} className="bg-surface border border-border-subtle rounded-xl p-2.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_72px_84px] items-center gap-2">
                          <span className="text-sm font-bold text-text-main truncate">{meal.name || 'Meal'}</span>

                          {(() => {
                            const budget = toNonNegativeNumber(form.nutrition.calorieBudget, 0);
                            const percentValue = toNonNegativeNumber(meal.targetValue, 0);
                            const calorieValue = round1((percentValue / 100) * budget);

                            return (
                              <>
                                <input
                                  type="number"
                                  min="0"
                                  value={percentValue}
                                  onChange={(e) => {
                                    if (mealInputMode !== 'percent') return;
                                    updateMeal(meal.id, { targetValue: Number(e.target.value) });
                                  }}
                                  disabled={mealInputMode !== 'percent'}
                                  className="w-full p-1.5 rounded-lg border border-border-subtle bg-card text-text-main text-xs text-right disabled:opacity-60"
                                  aria-label={`${meal.name || 'Meal'} target percent`}
                                />

                                <input
                                  type="number"
                                  min="0"
                                  value={calorieValue}
                                  onChange={(e) => {
                                    if (mealInputMode !== 'calories') return;
                                    const calories = toNonNegativeNumber(Number(e.target.value), 0);
                                    const nextPercent = budget > 0 ? round1((calories / budget) * 100) : 0;
                                    updateMeal(meal.id, { targetValue: nextPercent });
                                  }}
                                  disabled={mealInputMode !== 'calories'}
                                  className="w-full p-1.5 rounded-lg border border-border-subtle bg-card text-text-main text-xs text-right disabled:opacity-60"
                                  aria-label={`${meal.name || 'Meal'} target calories`}
                                />
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="pt-1">
                <div className="grid grid-cols-[minmax(0,1fr)_72px_84px] gap-2 px-2 items-center">
                  <span className="text-sm font-bold text-text-main">Daily calorie budget</span>
                  <span className="text-sm font-bold text-text-main text-right">{round1(totalMealPercent)}%</span>
                  <span className="text-sm font-bold text-text-main text-right">{round1(totalMealCalories)} Cal</span>
                </div>
                {!canSaveSettings && (
                  <p className="text-xs text-text-muted mt-1">
                    Warning: Meal totals must equal 100% and {dailyCalorieBudget} Cal to save settings.
                  </p>
                )}
              </div>
            </div>
          </OptionCard>

          <OptionCard
            title="Reminders"
            subtitle="Enable and schedule reminder times"
            isOpen={openSection === 'reminders'}
            onToggle={() => setOpenSection((prev) => (prev === 'reminders' ? null : 'reminders'))}
          >
            <div className="space-y-2">
              {REMINDER_KEYS.map((key) => (
                <div key={key} className="bg-surface border border-border-subtle rounded-xl px-3 py-2.5 flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={form.reminders[key].enabled}
                      onChange={(e) => updateReminder(key, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-border-subtle bg-card"
                    />
                    <span className="text-sm font-medium text-text-main capitalize">{key}</span>
                  </label>
                  <input
                    type="time"
                    value={form.reminders[key].time}
                    onChange={(e) => updateReminder(key, { time: e.target.value })}
                    disabled={!form.reminders[key].enabled}
                    className="p-2 rounded-lg border border-border-subtle bg-card text-text-main text-sm disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
          </OptionCard>

          {canSaveSettings ? (
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 rounded-xl bg-brand text-brand-fg font-black text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          ) : null}
        </form>

        <OptionCard
          title="Weight Log"
          subtitle="Add weight and view recent 7 entries"
          isOpen={openSection === 'weight'}
          onToggle={() => setOpenSection((prev) => (prev === 'weight' ? null : 'weight'))}
        >
          <form onSubmit={addWeight} className="grid grid-cols-3 gap-2 mb-4">
            <input
              type="date"
              value={weightForm.date}
              onChange={(e) => setWeightForm((prev) => ({ ...prev, date: e.target.value }))}
              className="col-span-2 p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
            />
            <select
              value={weightForm.unit}
              onChange={(e) => setWeightForm((prev) => ({ ...prev, unit: e.target.value }))}
              className="col-span-1 p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
            <input
              type="number"
              step="0.1"
              min="0"
              value={weightForm.value}
              onChange={(e) => setWeightForm((prev) => ({ ...prev, value: e.target.value }))}
              placeholder="Weight"
              className="col-span-3 p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
            />
            <button
              type="submit"
              className="col-span-3 py-3 rounded-xl bg-brand text-brand-fg font-black text-sm hover:opacity-90 transition-opacity"
            >
              Add Weight Entry
            </button>
          </form>

          <div className="space-y-2">
            {recentWeight.length === 0 ? (
              <div className="text-center py-6 bg-surface rounded-xl border border-border-subtle">
                <p className="text-sm text-text-muted">No weight entries yet.</p>
              </div>
            ) : (
              recentWeight.map((metric) => (
                <div
                  key={metric.id}
                  className="flex items-center justify-between bg-surface rounded-xl border border-border-subtle px-3 py-2.5"
                >
                  <span className="text-sm text-text-main font-medium">{metric.date}</span>
                  <span className="text-sm font-bold text-text-main">
                    {metric.value} {metric.unit}
                  </span>
                </div>
              ))
            )}
          </div>
        </OptionCard>
      </main>
    </div>
  );
}

function OptionCard({
  title,
  subtitle,
  isOpen,
  onToggle,
  children
}: {
  title: string;
  subtitle: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-2xl border border-border-subtle overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-4 text-left flex items-center justify-between hover:bg-surface transition-colors"
      >
        <div>
          <h2 className="text-base font-bold text-text-main">{title}</h2>
          <p className="text-xs text-text-muted">{subtitle}</p>
        </div>
        <span className="text-text-muted text-sm font-bold">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="p-4 border-t border-border-subtle">{children}</div>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );
}