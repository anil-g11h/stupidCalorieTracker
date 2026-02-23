import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { db, type BodyMetric, type Food, type UserSettings } from '../lib/db';
import { generateId } from '../lib';
import { supabase } from '../lib/supabaseClient';
import { useStackNavigation } from '../lib/useStackNavigation';

type SettingsRow = UserSettings & { id: 'local-settings' };

const SETTINGS_ID: SettingsRow['id'] = 'local-settings';

function toYyyyMmDd(date: Date) {
  return date.toISOString().split('T')[0];
}

function getWeekStart(date: Date) {
  const start = new Date(date);
  const day = start.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getWorkoutDurationMinutes(startTime: string, endTime?: string) {
  if (!endTime) return 0;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function toKg(value: number, unit: string) {
  if (unit === 'lb') return value / 2.20462;
  return value;
}

function fromKg(valueKg: number, unit: string) {
  if (unit === 'lb') return valueKg * 2.20462;
  return valueKg;
}

function getCreatedAtTime(value: BodyMetric['created_at']) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value as unknown as string).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function summaryStorageKey(date: string) {
  return `home-day-summary:${date}`;
}

const WATER_PORTION_OPTIONS = [
  { id: 'small-glass', label: 'Small glass', amount: 200, icon: '🥛' },
  { id: 'medium-mug', label: 'Medium mug', amount: 350, icon: '☕️' },
  { id: 'large-bottle', label: 'Large bottle', amount: 750, icon: '🧴' }
];

const DEFAULT_FIRST_WEIGHT_KG = 70;

export default function Home() {
  const { push } = useStackNavigation();
  const now = new Date();
  const today = useMemo(() => toYyyyMmDd(now), [now]);
  const weekStartIso = useMemo(() => getWeekStart(now).toISOString(), [now]);
  const [currentUserId, setCurrentUserId] = useState<string>('local-user');
  const [daySummary, setDaySummary] = useState('');
  const [activeHomePanel, setActiveHomePanel] = useState<'weight' | 'water' | 'sleep' | null>(null);
  const [weightForm, setWeightForm] = useState({
    date: today,
    value: '',
    unit: 'kg'
  });
  const [weightQuickAddFeedback, setWeightQuickAddFeedback] = useState('');
  const [weightGoalFeedback, setWeightGoalFeedback] = useState('');
  const [weightGoalModalOpen, setWeightGoalModalOpen] = useState(false);
  const [weightGoalDraft, setWeightGoalDraft] = useState('');
  const [weightSliderKg, setWeightSliderKg] = useState<number | null>(null);
  const [waterForm, setWaterForm] = useState({
    value: ''
  });
  const [waterQuickAddFeedback, setWaterQuickAddFeedback] = useState('');
  const [sleepForm, setSleepForm] = useState({
    date: today,
    value: ''
  });

  const recentWeight = useLiveQuery(
    async () => {
      const list = await db.metrics
        .where('type')
        .equals('weight')
        .and((row) => row.user_id === currentUserId)
        .toArray();

      return list
        .sort((a, b) => {
          if (a.date === b.date) return getCreatedAtTime(b.created_at) - getCreatedAtTime(a.created_at);
          return a.date < b.date ? 1 : -1;
        })
        .slice(0, 7);
    },
    [currentUserId],
    [] as BodyMetric[]
  );

  const recentWater = useLiveQuery(
    async () => {
      const list = await db.metrics
        .where('type')
        .equals('water')
        .and((row) => row.user_id === currentUserId)
        .toArray();

      return list
        .sort((a, b) => {
          if (a.date === b.date) return getCreatedAtTime(b.created_at) - getCreatedAtTime(a.created_at);
          return a.date < b.date ? 1 : -1;
        })
        .slice(0, 7);
    },
    [currentUserId],
    [] as BodyMetric[]
  );

  const recentSleep = useLiveQuery(
    async () => {
      const list = await db.metrics
        .where('type')
        .equals('sleep')
        .and((row) => row.user_id === currentUserId)
        .toArray();

      return list
        .sort((a, b) => {
          if (a.date === b.date) return getCreatedAtTime(b.created_at) - getCreatedAtTime(a.created_at);
          return a.date < b.date ? 1 : -1;
        })
        .slice(0, 7);
    },
    [currentUserId],
    [] as BodyMetric[]
  );

  const data = useLiveQuery(async () => {
    const [todayLogs, settings, workouts] = await Promise.all([
      db.logs.where('date').equals(today).toArray(),
      db.settings.get(SETTINGS_ID as string) as Promise<SettingsRow | undefined>,
      db.workouts.toArray()
    ]);

    const foodIds = [...new Set(todayLogs.map((log) => log.food_id))];
    const foods = foodIds.length ? await db.foods.where('id').anyOf(foodIds).toArray() : [];
    const foodsMap = foods.reduce<Record<string, Food>>((acc, food) => {
      acc[food.id] = food;
      return acc;
    }, {});

    const calorieTotals = todayLogs.reduce(
      (acc, log) => {
        const food = foodsMap[log.food_id];
        if (!food) return acc;
        const amount = Number(log.amount_consumed) || 0;
        acc.calories += food.calories * amount;
        acc.protein += food.protein * amount;
        acc.carbs += food.carbs * amount;
        acc.fat += food.fat * amount;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    const thisWeekWorkouts = workouts.filter((workout) => workout.start_time >= weekStartIso);
    const thisWeekMinutes = thisWeekWorkouts.reduce(
      (sum, workout) => sum + getWorkoutDurationMinutes(workout.start_time, workout.end_time),
      0
    );
    const todayWorkoutCount = workouts.filter((workout) => workout.start_time.startsWith(today)).length;

    return {
      settings,
      todayLogsCount: todayLogs.length,
      calorieTotals,
      workoutsCount: workouts.length,
      todayWorkoutCount,
      thisWeekWorkoutsCount: thisWeekWorkouts.length,
      thisWeekMinutes
    };
  }, [today, weekStartIso, currentUserId]);

  const calorieGoal = data?.settings?.nutrition?.calorieBudget ?? 2000;
  const proteinGoal =
    data?.settings?.nutrition?.proteinTargetGrams ??
    Math.round((calorieGoal * ((data?.settings?.nutrition?.proteinPercent ?? 30) / 100)) / 4);
  const carbsGoal =
    data?.settings?.nutrition?.carbsTargetGrams ??
    Math.round((calorieGoal * ((data?.settings?.nutrition?.carbPercent ?? 40) / 100)) / 4);
  const fatGoal =
    data?.settings?.nutrition?.fatTargetGrams ??
    Math.round((calorieGoal * ((data?.settings?.nutrition?.fatPercent ?? 30) / 100)) / 9);

  const caloriesConsumed = Math.round(data?.calorieTotals.calories ?? 0);
  const proteinConsumed = Math.round(data?.calorieTotals.protein ?? 0);
  const carbsConsumed = Math.round(data?.calorieTotals.carbs ?? 0);
  const fatConsumed = Math.round(data?.calorieTotals.fat ?? 0);
  const calorieProgress = Math.min((caloriesConsumed / Math.max(1, calorieGoal)) * 100, 100);
  const proteinProgress = Math.min((proteinConsumed / Math.max(1, proteinGoal)) * 100, 100);
  const carbsProgress = Math.min((carbsConsumed / Math.max(1, carbsGoal)) * 100, 100);
  const fatProgress = Math.min((fatConsumed / Math.max(1, fatGoal)) * 100, 100);
  const latestWeightLabel = recentWeight[0] ? `${recentWeight[0].value} ${recentWeight[0].unit}` : 'No entries yet';
  const latestWaterLabel = recentWater[0] ? `${recentWater[0].value} ${recentWater[0].unit}` : 'No entries yet';
  const latestSleepLabel = recentSleep[0] ? `${recentSleep[0].value} ${recentSleep[0].unit}` : 'No entries yet';
  const waterGoal = Math.max(0, data?.settings?.nutrition?.waterTarget ?? 0);
  const sleepGoal = Math.max(0, data?.settings?.nutrition?.sleepTarget ?? 0);
  const todayWater = recentWater.filter((entry) => entry.date === today).reduce((sum, entry) => sum + (entry.value || 0), 0);
  const todaySleep = recentSleep.filter((entry) => entry.date === today).reduce((sum, entry) => sum + (entry.value || 0), 0);
  const hasWeightToday = recentWeight.some((entry) => entry.date === today);
  const waterProgress = waterGoal > 0 ? Math.min((todayWater / waterGoal) * 100, 100) : todayWater > 0 ? 100 : 0;
  const sleepBlocksTotal = sleepGoal > 0 ? Math.max(4, Math.min(10, Math.round(sleepGoal))) : 8;
  const sleepBlocksFilled = Math.max(
    0,
    Math.min(
      sleepBlocksTotal,
      Math.round(((sleepGoal > 0 ? todaySleep / Math.max(1, sleepGoal) : todaySleep / 8) * sleepBlocksTotal))
    )
  );
  const previousWeightEntry = recentWeight[0];
  const previousWeightKg = previousWeightEntry ? toKg(previousWeightEntry.value, previousWeightEntry.unit) : null;
  const goalWeightKg = (data?.settings?.nutrition?.weightTarget ?? 0) > 0 ? (data?.settings?.nutrition?.weightTarget as number) : null;
  const oldestWeightEntry = recentWeight[recentWeight.length - 1];
  const startWeightKg = oldestWeightEntry ? toKg(oldestWeightEntry.value, oldestWeightEntry.unit) : null;
  const distanceToGoalKg =
    goalWeightKg !== null && previousWeightKg !== null ? Math.abs(previousWeightKg - goalWeightKg) : null;
  const goalJourneyProgress =
    goalWeightKg !== null && previousWeightKg !== null && startWeightKg !== null
      ? (() => {
          const totalDistance = Math.abs(startWeightKg - goalWeightKg);
          const remaining = Math.abs(previousWeightKg - goalWeightKg);
          if (totalDistance <= 0) return previousWeightKg === goalWeightKg ? 100 : 0;
          return Math.min(100, Math.max(0, (1 - remaining / totalDistance) * 100));
        })()
      : null;
  const weightTrend = useMemo(() => {
    if (recentWeight.length === 0) {
      return {
        points: '',
        goalY: null as number | null,
        entriesAsc: [] as Array<{ date: string; valueKg: number }>,
        firstKg: null as number | null,
        lastKg: null as number | null,
        deltaKg: null as number | null
      };
    }

    const entriesAsc = [...recentWeight]
      .sort((a, b) => {
        if (a.date === b.date) return getCreatedAtTime(a.created_at) - getCreatedAtTime(b.created_at);
        return a.date < b.date ? -1 : 1;
      })
      .map((entry) => ({
        date: entry.date,
        valueKg: Math.round(toKg(entry.value, entry.unit) * 10) / 10
      }));

    const values = entriesAsc.map((entry) => entry.valueKg);
    const minValue = Math.min(...values, goalWeightKg ?? Number.POSITIVE_INFINITY);
    const maxValue = Math.max(...values, goalWeightKg ?? Number.NEGATIVE_INFINITY);
    const range = Math.max(0.5, maxValue - minValue);
    const chartMin = minValue - range * 0.15;
    const chartMax = maxValue + range * 0.15;

    const toY = (value: number) => {
      const normalized = (value - chartMin) / Math.max(0.001, chartMax - chartMin);
      return Math.min(38, Math.max(6, 38 - normalized * 32));
    };

    const points = entriesAsc
      .map((entry, index) => {
        const x = entriesAsc.length === 1 ? 50 : (index / (entriesAsc.length - 1)) * 100;
        const y = toY(entry.valueKg);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

    const firstKg = entriesAsc[0]?.valueKg ?? null;
    const lastKg = entriesAsc[entriesAsc.length - 1]?.valueKg ?? null;
    const deltaKg = firstKg !== null && lastKg !== null ? Math.round((lastKg - firstKg) * 10) / 10 : null;

    return {
      points,
      goalY: goalWeightKg !== null ? toY(goalWeightKg) : null,
      entriesAsc,
      firstKg,
      lastKg,
      deltaKg
    };
  }, [recentWeight, goalWeightKg]);
  const sliderAnchorsKg = [previousWeightKg, goalWeightKg].filter((value): value is number => value !== null);
  const sliderSeedWeightsKg = sliderAnchorsKg.length > 0 ? sliderAnchorsKg : [DEFAULT_FIRST_WEIGHT_KG];
  const sliderMinKg = Math.max(20, Math.floor(Math.min(...sliderSeedWeightsKg.map((value) => value - 5))));
  const sliderMaxKg = Math.min(300, Math.ceil(Math.max(...sliderSeedWeightsKg.map((value) => value + 5), 100)));
  const sliderValueKg = weightSliderKg ?? previousWeightKg ?? goalWeightKg ?? DEFAULT_FIRST_WEIGHT_KG;
  const goalMarkerPercent =
    goalWeightKg !== null && sliderMaxKg > sliderMinKg
      ? Math.min(100, Math.max(0, ((goalWeightKg - sliderMinKg) / (sliderMaxKg - sliderMinKg)) * 100))
      : null;

  useEffect(() => {
    if (previousWeightKg !== null) {
      setWeightSliderKg(Math.round(previousWeightKg * 10) / 10);
      return;
    }
    if (goalWeightKg !== null) {
      setWeightSliderKg(Math.round(goalWeightKg * 10) / 10);
      return;
    }
    setWeightSliderKg(DEFAULT_FIRST_WEIGHT_KG);
  }, [previousWeightKg, goalWeightKg]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? 'local-user');
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? 'local-user');
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedSummary = window.localStorage.getItem(summaryStorageKey(today));
    setDaySummary(storedSummary ?? '');
  }, [today]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(summaryStorageKey(today), daySummary);
  }, [today, daySummary]);

  const saveWeightMetric = async (valueInput: number, dateInput?: string, unitInput?: string) => {
    const value = Number(valueInput);
    const unit = unitInput || weightForm.unit;

    if (!Number.isFinite(value) || value <= 0) {
      alert('Enter a valid weight');
      return false;
    }

    try {
      const metric: BodyMetric = {
        id: generateId(),
        user_id: currentUserId,
        date: dateInput || weightForm.date || today,
        type: 'weight',
        value: Math.round(value * 10) / 10,
        unit,
        synced: 0,
        created_at: new Date()
      };

      await db.metrics.put(metric);
      return true;
    } catch (error) {
      console.error(error);
      alert('Failed to add weight');
      return false;
    }
  };

  const addWeightFromSlider = async () => {
    if (weightSliderKg === null || !Number.isFinite(weightSliderKg) || weightSliderKg <= 0) {
      alert('Adjust the slider first');
      return;
    }

    const nextUnit = previousWeightEntry?.unit === 'lb' ? 'lb' : weightForm.unit;
    const nextValueInUnit = Math.round(fromKg(weightSliderKg, nextUnit) * 10) / 10;
    const didSave = await saveWeightMetric(nextValueInUnit, weightForm.date || today, nextUnit);
    if (!didSave) return;

    setWeightForm((prev) => ({ ...prev, value: String(nextValueInUnit), unit: nextUnit }));
    setWeightQuickAddFeedback(`Saved ${nextValueInUnit} ${nextUnit}`);
    setTimeout(() => setWeightQuickAddFeedback(''), 1400);
  };

  const addSameAsPreviousWeight = async () => {
    if (!previousWeightEntry) {
      alert('No previous weight available yet');
      return;
    }

    const didSave = await saveWeightMetric(
      previousWeightEntry.value,
      weightForm.date || today,
      previousWeightEntry.unit
    );
    if (!didSave) return;

    setWeightForm((prev) => ({ ...prev, value: String(previousWeightEntry.value), unit: previousWeightEntry.unit }));
    setWeightQuickAddFeedback(`Saved ${previousWeightEntry.value} ${previousWeightEntry.unit}`);
    setTimeout(() => setWeightQuickAddFeedback(''), 1400);
  };

  const saveWeightGoal = async (valueInput: number) => {
    const value = Number(valueInput);
    if (!Number.isFinite(value) || value <= 0) {
      alert('Enter a valid goal weight');
      return false;
    }

    try {
      const existingSettings = (await db.settings.get(SETTINGS_ID as string)) as SettingsRow | undefined;
      const settingsToSave: SettingsRow = {
        ...(existingSettings ?? ({ id: SETTINGS_ID, nutrition: {}, meals: [], reminders: {}, updated_at: '' } as any)),
        id: SETTINGS_ID,
        user_id: currentUserId,
        nutrition: {
          ...(existingSettings?.nutrition ?? {}),
          calorieBudget: existingSettings?.nutrition?.calorieBudget ?? calorieGoal,
          proteinPercent: existingSettings?.nutrition?.proteinPercent ?? 30,
          carbPercent: existingSettings?.nutrition?.carbPercent ?? 40,
          fatPercent: existingSettings?.nutrition?.fatPercent ?? 30,
          fiberGrams: existingSettings?.nutrition?.fiberGrams ?? 30,
          proteinTargetGrams: existingSettings?.nutrition?.proteinTargetGrams ?? proteinGoal,
          carbsTargetGrams: existingSettings?.nutrition?.carbsTargetGrams ?? carbsGoal,
          fatTargetGrams: existingSettings?.nutrition?.fatTargetGrams ?? fatGoal,
          sleepTarget: existingSettings?.nutrition?.sleepTarget ?? sleepGoal,
          waterTarget: existingSettings?.nutrition?.waterTarget ?? waterGoal,
          weightTarget: Math.round(value * 10) / 10
        },
        meals: existingSettings?.meals ?? [],
        reminders: existingSettings?.reminders ?? ({ food: { enabled: true, time: '08:00' }, water: { enabled: true, time: '10:00' }, workout: { enabled: false, time: '18:00' }, walk: { enabled: false, time: '17:00' }, weight: { enabled: false, time: '07:00' }, medicine: { enabled: false, time: '09:00' } } as any),
        updated_at: new Date().toISOString(),
        synced: 0
      };

      await db.settings.put(settingsToSave);
      setWeightGoalFeedback(`Goal saved: ${settingsToSave.nutrition.weightTarget} kg`);
      setTimeout(() => setWeightGoalFeedback(''), 1600);
      return true;
    } catch (error) {
      console.error(error);
      alert('Failed to save weight goal');
      return false;
    }
  };

  const openWeightGoalModal = () => {
    setWeightGoalDraft(goalWeightKg !== null ? goalWeightKg.toFixed(1) : '');
    setWeightGoalModalOpen(true);
  };

  const saveWeightGoalFromModal = async () => {
    const didSave = await saveWeightGoal(Number(weightGoalDraft));
    if (!didSave) return;
    setWeightGoalModalOpen(false);
  };

  const saveWaterMetric = async (valueInput: number) => {
    const value = Number(valueInput);
    if (!Number.isFinite(value) || value <= 0) {
      alert('Enter a valid water intake');
      return false;
    }

    try {
      const metric: BodyMetric = {
        id: generateId(),
        user_id: currentUserId,
        date: today,
        type: 'water',
        value: Math.round(value),
        unit: 'ml',
        synced: 0,
        created_at: new Date()
      };

      await db.metrics.put(metric);
      return true;
    } catch (error) {
      console.error(error);
      alert('Failed to add water intake');
      return false;
    }
  };

  const addWater = async (event: React.FormEvent) => {
    event.preventDefault();
    const didSave = await saveWaterMetric(Number(waterForm.value));
    if (didSave) {
      setWaterForm((prev) => ({ ...prev, value: '' }));
    }
  };

  const addWaterQuickOption = async (amount: number) => {
    const didSave = await saveWaterMetric(amount);
    if (!didSave) return;

    setWaterQuickAddFeedback(`Added ${amount} ml`);
    setTimeout(() => setWaterQuickAddFeedback(''), 1400);
  };

  const addSleep = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(sleepForm.value);

    if (!Number.isFinite(value) || value <= 0) {
      alert('Enter valid sleep hours');
      return;
    }

    try {
      const metric: BodyMetric = {
        id: generateId(),
        user_id: currentUserId,
        date: sleepForm.date || today,
        type: 'sleep',
        value: Math.round(value * 10) / 10,
        unit: 'hrs',
        synced: 0,
        created_at: new Date()
      };

      await db.metrics.put(metric);
      setSleepForm((prev) => ({ ...prev, value: '' }));
    } catch (error) {
      console.error(error);
      alert('Failed to add sleep log');
    }
  };

  const setPanelWithTransition = (panel: 'weight' | 'water' | 'sleep' | null, direction: 'forward' | 'backward') => {
    if (!document.startViewTransition) {
      setActiveHomePanel(panel);
      return;
    }

    document.documentElement.classList.add(`transition-${direction}`);
    const transition = document.startViewTransition(() => {
      setActiveHomePanel(panel);
    });
    transition.finished.finally(() => {
      document.documentElement.classList.remove(`transition-${direction}`);
    });
  };

  if (activeHomePanel === 'weight') {
    return (
      <div className="min-h-screen bg-page pb-24 font-sans">
        <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPanelWithTransition(null, 'backward')}
              className="h-9 w-9 rounded-lg border border-border-subtle bg-surface text-text-main flex items-center justify-center"
              aria-label="Back"
            >
              <CaretLeftIcon size={18} weight="bold" />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold text-text-main">Weight log</h1>
              <p className="text-xs text-text-muted mt-0.5">Add and review your recent entries</p>
            </div>
            <div className="h-9 w-9" />
          </div>
        </header>

        <main className="max-w-md mx-auto p-4">
          <section className="bg-card rounded-2xl p-5 border border-border-subtle shadow-sm">
            <div className="mb-3 rounded-xl border border-border-subtle bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Goal setup</p>
                {weightGoalFeedback ? <p className="text-xs font-semibold text-brand">{weightGoalFeedback}</p> : null}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-card border border-border-subtle px-3 py-2">
                  <p className="text-[11px] text-text-muted">Current</p>
                  <p className="text-base font-bold text-text-main">
                    {previousWeightKg !== null ? `${previousWeightKg.toFixed(1)} kg` : '--'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openWeightGoalModal}
                  className="rounded-lg bg-card border border-border-subtle px-3 py-2 text-left hover:border-brand-light transition-all"
                >
                  <p className="text-[11px] text-text-muted">Goal</p>
                  <p className="text-base font-bold text-text-main">
                    {goalWeightKg !== null ? `${goalWeightKg.toFixed(1)} kg` : '--'}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">Tap to edit</p>
                </button>
              </div>

              {distanceToGoalKg !== null ? (
                <div className="mt-2">
                  <div className="h-1.5 rounded-full bg-card overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full transition-all duration-500"
                      style={{ width: `${goalJourneyProgress ?? 0}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-text-muted mt-1">
                    {distanceToGoalKg.toFixed(1)} kg away from goal
                    {goalJourneyProgress !== null ? ` • Progress ${(goalJourneyProgress).toFixed(0)}%` : ''}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mb-3 rounded-xl border border-border-subtle bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Progress chart</p>
                <p className="text-[11px] text-text-muted">{weightTrend.entriesAsc.length} points</p>
              </div>

              {weightTrend.entriesAsc.length < 2 ? (
                <p className="text-xs text-text-muted mt-2">Add at least 2 entries to see a trend line.</p>
              ) : (
                <>
                  <div className="mt-2 rounded-lg bg-card border border-border-subtle px-2 py-2">
                    <svg viewBox="0 0 100 44" className="w-full h-24" role="img" aria-label="Weight progress chart">
                      {weightTrend.goalY !== null ? (
                        <line x1="0" x2="100" y1={weightTrend.goalY} y2={weightTrend.goalY} className="stroke-text-muted" strokeDasharray="2 2" strokeWidth="0.6" />
                      ) : null}
                      <polyline points={weightTrend.points} fill="none" className="stroke-brand" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      {weightTrend.entriesAsc.map((entry, index) => {
                        const x = weightTrend.entriesAsc.length === 1 ? 50 : (index / (weightTrend.entriesAsc.length - 1)) * 100;
                        const values = weightTrend.entriesAsc.map((item) => item.valueKg);
                        const minValue = Math.min(...values, goalWeightKg ?? Number.POSITIVE_INFINITY);
                        const maxValue = Math.max(...values, goalWeightKg ?? Number.NEGATIVE_INFINITY);
                        const range = Math.max(0.5, maxValue - minValue);
                        const chartMin = minValue - range * 0.15;
                        const chartMax = maxValue + range * 0.15;
                        const normalized = (entry.valueKg - chartMin) / Math.max(0.001, chartMax - chartMin);
                        const y = Math.min(38, Math.max(6, 38 - normalized * 32));
                        return <circle key={`${entry.date}-${index}`} cx={x} cy={y} r="1.2" className="fill-brand" />;
                      })}
                    </svg>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                    <p className="text-text-muted">
                      Start: <span className="font-semibold text-text-main">{weightTrend.firstKg?.toFixed(1)} kg</span>
                    </p>
                    <p className="text-text-muted">
                      Now: <span className="font-semibold text-text-main">{weightTrend.lastKg?.toFixed(1)} kg</span>
                    </p>
                    <p className="text-text-muted">
                      Change:{' '}
                      <span className="font-semibold text-text-main">
                        {weightTrend.deltaKg !== null ? `${weightTrend.deltaKg > 0 ? '+' : ''}${weightTrend.deltaKg.toFixed(1)} kg` : '--'}
                      </span>
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="mb-3 rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Quick from previous</p>
                {weightQuickAddFeedback ? <p className="text-xs font-semibold text-brand">{weightQuickAddFeedback}</p> : null}
              </div>
              {
                <>
                  <p className="text-sm text-text-main mt-1">
                    Previous:{' '}
                    <span className="font-bold">
                      {previousWeightEntry ? `${previousWeightEntry.value} ${previousWeightEntry.unit}` : '—'}
                    </span>
                  </p>
                  <div className="mt-2">
                    <div className="flex items-center justify-between gap-2 text-xs text-text-muted mb-1">
                      <span>{sliderMinKg} kg</span>
                      <span className="font-semibold text-text-main">{sliderValueKg.toFixed(1)} kg</span>
                      <span>{sliderMaxKg} kg</span>
                    </div>
                    <div className="relative">
                      <input
                        type="range"
                        min={sliderMinKg}
                        max={sliderMaxKg}
                        step={0.5}
                        value={sliderValueKg}
                        onChange={(event) => setWeightSliderKg(Number(event.target.value))}
                        className="w-full accent-brand"
                      />
                      {goalMarkerPercent !== null ? (
                        <div
                          className="absolute -top-1 h-5 w-0.5 bg-text-muted"
                          style={{ left: `${goalMarkerPercent}%` }}
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[11px] text-text-muted">
                        {goalWeightKg !== null ? `Goal marker: ${goalWeightKg.toFixed(1)} kg` : 'Set weight goal in profile for marker'}
                      </p>
                      <button
                        type="button"
                        onClick={() => void addWeightFromSlider()}
                        className="rounded-lg border border-border-subtle bg-card px-2.5 py-1 text-xs font-semibold text-text-main hover:border-brand-light"
                      >
                        Save slider
                      </button>
                    </div>
                  </div>
                  {previousWeightEntry ? (
                    <button
                      type="button"
                      onClick={() => void addSameAsPreviousWeight()}
                      className="mt-2 w-full rounded-lg border border-border-subtle bg-card px-3 py-2 text-sm font-semibold text-text-main hover:border-brand-light"
                    >
                      Same as previous
                    </button>
                  ) : (
                    <p className="text-[11px] text-text-muted mt-2">Use the slider and tap Save slider to add your first entry.</p>
                  )}
                </>
              }
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Latest entry</p>
              {recentWeight[0] ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-text-muted">{recentWeight[0].date}</p>
                  <p className="text-sm font-semibold text-text-main">
                    {recentWeight[0].value} {recentWeight[0].unit}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-text-muted mt-1">No weight entries yet.</p>
              )}
            </div>

            {weightGoalModalOpen ? (
              <div className="fixed inset-0 z-40 bg-black/30 flex items-end sm:items-center justify-center p-4">
                <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-card p-4 shadow-lg">
                  <p className="text-sm font-bold text-text-main">Set weight goal</p>
                  <p className="text-xs text-text-muted mt-1">Enter target in kg</p>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={weightGoalDraft}
                    onChange={(e) => setWeightGoalDraft(e.target.value)}
                    placeholder="Goal weight"
                    className="mt-3 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setWeightGoalModalOpen(false)}
                      className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs font-semibold text-text-main"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveWeightGoalFromModal()}
                      className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-fg"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </main>
      </div>
    );
  }

  if (activeHomePanel === 'water') {
    return (
      <div className="min-h-screen bg-page pb-24 font-sans">
        <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPanelWithTransition(null, 'backward')}
              className="h-9 w-9 rounded-lg border border-border-subtle bg-surface text-text-main flex items-center justify-center"
              aria-label="Back"
            >
              <CaretLeftIcon size={18} weight="bold" />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold text-text-main">Water tracker</h1>
              <p className="text-xs text-text-muted mt-0.5">Add and review water intake</p>
            </div>
            <div className="h-9 w-9" />
          </div>
        </header>

        <main className="max-w-md mx-auto p-4">
          <section className="bg-card rounded-2xl p-5 border border-border-subtle shadow-sm">
            <div className="mb-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Quick add (one tap)</p>
                {waterQuickAddFeedback ? <p className="text-xs font-semibold text-brand">{waterQuickAddFeedback}</p> : null}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {WATER_PORTION_OPTIONS.map((option) => {
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => void addWaterQuickOption(option.amount)}
                      className="rounded-xl border border-border-subtle bg-surface text-text-main hover:border-brand-light transition-all px-2 py-2 text-center"
                    >
                      <p className="text-base leading-none">{option.icon}</p>
                      <p className="text-[11px] font-semibold mt-1">{option.label}</p>
                      <p className="text-[10px] text-text-muted mt-0.5">{option.amount} ml</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={addWater} className="grid grid-cols-3 gap-2 mb-3">
              <input
                type="number"
                step="1"
                min="0"
                value={waterForm.value}
                onChange={(e) => setWaterForm((prev) => ({ ...prev, value: e.target.value }))}
                placeholder="Water (ml)"
                className="col-span-2 p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
              />
              <button
                type="submit"
                className="col-span-1 py-2.5 rounded-xl bg-brand text-brand-fg font-bold text-xs hover:opacity-90 transition-opacity"
              >
                Add
              </button>
            </form>

            <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Latest entry</p>
              {recentWater[0] ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-text-muted">{recentWater[0].date}</p>
                  <p className="text-sm font-semibold text-text-main">
                    {recentWater[0].value} {recentWater[0].unit}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-text-muted mt-1">No water entries yet.</p>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (activeHomePanel === 'sleep') {
    return (
      <div className="min-h-screen bg-page pb-24 font-sans">
        <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPanelWithTransition(null, 'backward')}
              className="h-9 w-9 rounded-lg border border-border-subtle bg-surface text-text-main flex items-center justify-center"
              aria-label="Back"
            >
              <CaretLeftIcon size={18} weight="bold" />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold text-text-main">Sleep tracker</h1>
              <p className="text-xs text-text-muted mt-0.5">Add and review sleep hours</p>
            </div>
            <div className="h-9 w-9" />
          </div>
        </header>

        <main className="max-w-md mx-auto p-4">
          <section className="bg-card rounded-2xl p-5 border border-border-subtle shadow-sm">
            <form onSubmit={addSleep} className="grid grid-cols-3 gap-2 mb-3">
              <input
                type="date"
                value={sleepForm.date}
                onChange={(e) => setSleepForm((prev) => ({ ...prev, date: e.target.value }))}
                className="col-span-2 p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
              />
              <div className="col-span-1 p-2.5 rounded-xl border border-border-subtle bg-surface text-text-muted text-sm flex items-center justify-center font-medium">
                hrs
              </div>
              <input
                type="number"
                step="0.1"
                min="0"
                value={sleepForm.value}
                onChange={(e) => setSleepForm((prev) => ({ ...prev, value: e.target.value }))}
                placeholder="Sleep"
                className="col-span-2 p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
              />
              <button
                type="submit"
                className="col-span-1 py-2.5 rounded-xl bg-brand text-brand-fg font-bold text-xs hover:opacity-90 transition-opacity"
              >
                Add
              </button>
            </form>

            <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Latest entry</p>
              {recentSleep[0] ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-text-muted">{recentSleep[0].date}</p>
                  <p className="text-sm font-semibold text-text-main">
                    {recentSleep[0].value} {recentSleep[0].unit}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-text-muted mt-1">No sleep entries yet.</p>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page pb-24 font-sans">
      <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
        <div className="max-w-md mx-auto px-4 py-3">
          <h1 className="text-2xl font-extrabold text-text-main">Dashboard</h1>
          <p className="text-xs text-text-muted mt-0.5">Today&apos;s overview across calories and workouts</p>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        <button
          type="button"
          onClick={() => push('/log')}
          className="block bg-card rounded-2xl p-6 border border-border-subtle shadow-sm hover:border-brand-light transition-all active:scale-[0.99]"
        >
          <p className="mt-2 text-3xl font-extrabold text-text-main">
            {caloriesConsumed} of {Math.round(calorieGoal)}{' '}
            <span className="text-sm font-semibold text-text-muted align-middle">Calories Eaten</span>
            <span className="ml-2 text-xs font-bold text-brand bg-surface px-2.5 py-1 rounded-full align-middle">
              {data?.todayLogsCount ?? 0} logs
            </span>
          </p>

          <div className="mt-3 h-4 bg-surface rounded-full overflow-hidden shadow-inner">
            <div
              className="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-700 ease-out shadow-sm"
              style={{ width: `${calorieProgress}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-6 mt-6">
            <div className="text-center">
              <p className="text-xs text-text-muted mb-2 font-medium">Protein</p>
              <div className="relative h-2 bg-surface rounded-full mb-2">
                <div
                  className="absolute top-0 left-0 h-full bg-macro-protein rounded-full transition-all duration-500"
                  style={{ width: `${proteinProgress}%` }}
                />
              </div>
              <p className="text-xs font-bold text-text-main">{proteinConsumed} <span className="text-text-muted font-normal">/ {proteinGoal}g</span></p>
            </div>

            <div className="text-center">
              <p className="text-xs text-text-muted mb-2 font-medium">Carbs</p>
              <div className="relative h-2 bg-surface rounded-full mb-2">
                <div
                  className="absolute top-0 left-0 h-full bg-macro-carbs rounded-full transition-all duration-500"
                  style={{ width: `${carbsProgress}%` }}
                />
              </div>
              <p className="text-xs font-bold text-text-main">{carbsConsumed} <span className="text-text-muted font-normal">/ {carbsGoal}g</span></p>
            </div>

            <div className="text-center">
              <p className="text-xs text-text-muted mb-2 font-medium">Fat</p>
              <div className="relative h-2 bg-surface rounded-full mb-2">
                <div
                  className="absolute top-0 left-0 h-full bg-macro-fat rounded-full transition-all duration-500"
                  style={{ width: `${fatProgress}%` }}
                />
              </div>
              <p className="text-xs font-bold text-text-main">{fatConsumed} <span className="text-text-muted font-normal">/ {fatGoal}g</span></p>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => push('/workouts')}
          className="block bg-card rounded-2xl p-5 border border-border-subtle shadow-sm hover:border-brand-light transition-all active:scale-[0.99]"
        >
          <p className="text-sm font-bold uppercase tracking-wide text-text-muted">Workout</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="bg-surface rounded-xl p-2.5 text-center">
              <p className="text-2xl font-extrabold text-text-main">{data?.todayWorkoutCount ?? 0}</p>
              <p className="text-[11px] text-text-muted">Today</p>
            </div>
            <div className="bg-surface rounded-xl p-2.5 text-center">
              <p className="text-2xl font-extrabold text-text-main">{data?.thisWeekWorkoutsCount ?? 0}</p>
              <p className="text-[11px] text-text-muted">This week</p>
            </div>
            <div className="bg-surface rounded-xl p-2.5 text-center">
              <p className="text-2xl font-extrabold text-text-main">{data?.thisWeekMinutes ?? 0}</p>
              <p className="text-[11px] text-text-muted">Week mins</p>
            </div>
          </div>
          <p className="mt-3 text-xs font-medium text-text-muted">Total workouts logged: {data?.workoutsCount ?? 0}</p>
        </button>

        <section className="bg-card rounded-2xl p-5 border border-border-subtle shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-text-muted">Trackers</p>
              <p className="text-xs text-text-muted mt-1">Quickly log weight, water, and sleep</p>
            </div>
            <span className="text-[11px] font-semibold text-text-muted bg-surface px-2 py-1 rounded-full">3 trackers</span>
          </div>

          <div className="mt-4 space-y-2.5">
            <button
              type="button"
              onClick={() => setPanelWithTransition('weight', 'forward')}
              className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-3 text-left hover:border-brand-light transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-main">Weight log</p>
                  <p className="text-xs text-text-muted mt-0.5">Latest: {latestWeightLabel}</p>
                </div>
                <span className="text-[11px] font-semibold text-text-muted">Open</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    hasWeightToday ? 'bg-brand text-brand-fg' : 'bg-card text-text-muted border border-border-subtle'
                  }`}
                >
                  {hasWeightToday ? 'Logged today' : 'Pending'}
                </span>
                <p className="text-[11px] text-text-muted">Daily check-in</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPanelWithTransition('water', 'forward')}
              className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-3 text-left hover:border-brand-light transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-main">Water log</p>
                  <p className="text-xs text-text-muted mt-0.5">Latest: {latestWaterLabel}</p>
                </div>
                <span className="text-[11px] font-semibold text-text-muted">Open</span>
              </div>
              <div className="mt-2">
                <div className="h-1.5 rounded-full bg-card overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full transition-all duration-500"
                    style={{ width: `${waterProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-text-muted mt-1">
                  {waterGoal > 0 ? `${Math.round(todayWater)} / ${Math.round(waterGoal)} ml today` : `${Math.round(todayWater)} ml today`}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPanelWithTransition('sleep', 'forward')}
              className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-3 text-left hover:border-brand-light transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-main">Sleep log</p>
                  <p className="text-xs text-text-muted mt-0.5">Latest: {latestSleepLabel}</p>
                </div>
                <span className="text-[11px] font-semibold text-text-muted">Open</span>
              </div>
              <div className="mt-2">
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${sleepBlocksTotal}, minmax(0, 1fr))` }}>
                  {Array.from({ length: sleepBlocksTotal }).map((_, index) => (
                    <div
                      key={index}
                      className={`h-1.5 rounded-full ${index < sleepBlocksFilled ? 'bg-brand' : 'bg-card border border-border-subtle'}`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-text-muted mt-1">
                  {sleepGoal > 0 ? `${todaySleep.toFixed(1)} / ${sleepGoal.toFixed(1)} hrs today` : `${todaySleep.toFixed(1)} hrs today`}
                </p>
              </div>
            </button>
          </div>
        </section>

        <section className="bg-card rounded-2xl p-5 border border-border-subtle shadow-sm">
          <label htmlFor="day-summary" className="block text-sm font-bold uppercase tracking-wide text-text-muted mb-2">
            How did your day go?
          </label>
          <input
            id="day-summary"
            type="text"
            value={daySummary}
            onChange={(event) => setDaySummary(event.target.value)}
            placeholder="Share your day in a short note"
            className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </section>
      </main>
    </div>
  );
}