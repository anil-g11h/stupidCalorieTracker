import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { db, type BodyMetric, type Food, type Profile, type UserSettings, type Workout } from '../lib/db';
import { generateId } from '../lib';
import { fetchGeminiDailyCoach, type GeminiDailyCoachPayload } from '../lib/gemini';
import { analyzeEaaRatio } from '../lib/eaa';
import { supabase } from '../lib/supabaseClient';
import { useStackNavigation } from '../lib/useStackNavigation';
import RouteHeader from '../lib/components/RouteHeader';
import { getFastingWindowHint, getMealTimingAdvice } from './profile/mealPlanning';

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

type WorkoutProgressWindow = 'three-month' | 'six-month' | 'yearly';

interface WorkoutProgressBucket {
  id: string;
  label: string;
  value: number;
}

interface WorkoutProgressChart {
  window: WorkoutProgressWindow;
  title: string;
  subtitle: string;
  buckets: WorkoutProgressBucket[];
  maxValue: number;
}

const WORKOUT_PROGRESS_BAR_COUNT = 10;

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getDaysTracked(workouts: Workout[], now: Date) {
  const timestamps = workouts
    .map((workout) => new Date(workout.start_time).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return 0;

  const earliest = Math.min(...timestamps);
  const todayStart = startOfDay(now).getTime();
  const earliestStart = startOfDay(new Date(earliest)).getTime();
  const spanMs = Math.max(0, todayStart - earliestStart);
  return Math.floor(spanMs / 86400000) + 1;
}

function selectWorkoutWindow(daysTracked: number): WorkoutProgressWindow {
  if (daysTracked < 180) return 'three-month';
  if (daysTracked < 365) return 'six-month';
  return 'yearly';
}

function buildWorkoutProgressChart(workouts: Workout[], now: Date): WorkoutProgressChart {
  const daysTracked = getDaysTracked(workouts, now);
  const window = selectWorkoutWindow(daysTracked);
  const workoutDates = workouts
    .map((workout) => startOfDay(new Date(workout.start_time)))
    .filter((value) => Number.isFinite(value.getTime()));
  const todayStart = startOfDay(now);

  if (window === 'three-month') {
    const formatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' });
    const bucketSizeDays = 9;
    const rangeDays = WORKOUT_PROGRESS_BAR_COUNT * bucketSizeDays;
    const rangeStart = addDays(todayStart, -(rangeDays - 1));
    const buckets = Array.from({ length: WORKOUT_PROGRESS_BAR_COUNT }, (_, index) => {
      const start = addDays(rangeStart, index * bucketSizeDays);
      const end = addDays(start, bucketSizeDays);
      const value = workoutDates.filter(
        (workoutDay) => workoutDay.getTime() >= start.getTime() && workoutDay.getTime() < end.getTime()
      ).length;
      return {
        id: start.toISOString().split('T')[0],
        label: formatter.format(start),
        value
      };
    });

    return {
      window,
      title: '3-month progress',
      subtitle: 'Workouts per month',
      buckets,
      maxValue: Math.max(1, ...buckets.map((bucket) => bucket.value))
    };
  }

  if (window === 'six-month') {
    const formatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' });
    const bucketSizeDays = 18;
    const rangeDays = WORKOUT_PROGRESS_BAR_COUNT * bucketSizeDays;
    const rangeStart = addDays(todayStart, -(rangeDays - 1));
    const buckets = Array.from({ length: WORKOUT_PROGRESS_BAR_COUNT }, (_, index) => {
      const start = addDays(rangeStart, index * bucketSizeDays);
      const end = addDays(start, bucketSizeDays);
      const value = workoutDates.filter(
        (workoutDay) => workoutDay.getTime() >= start.getTime() && workoutDay.getTime() < end.getTime()
      ).length;
      return {
        id: start.toISOString().split('T')[0],
        label: formatter.format(start),
        value
      };
    });

    return {
      window,
      title: '6-month progress',
      subtitle: 'Workouts per period',
      buckets,
      maxValue: Math.max(1, ...buckets.map((bucket) => bucket.value))
    };
  }

  const formatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' });
  const bucketSizeDays = 36;
  const rangeDays = WORKOUT_PROGRESS_BAR_COUNT * bucketSizeDays;
  const rangeStart = addDays(todayStart, -(rangeDays - 1));
  const buckets = Array.from({ length: WORKOUT_PROGRESS_BAR_COUNT }, (_, index) => {
    const start = addDays(rangeStart, index * bucketSizeDays);
    const end = addDays(start, bucketSizeDays);
    const value = workoutDates.filter(
      (workoutDay) => workoutDay.getTime() >= start.getTime() && workoutDay.getTime() < end.getTime()
    ).length;
    return {
      id: start.toISOString().split('T')[0],
      label: formatter.format(start),
      value
    };
  });

  return {
    window,
    title: 'Yearly progress',
    subtitle: 'Workouts per period',
    buckets,
    maxValue: Math.max(1, ...buckets.map((bucket) => bucket.value))
  };
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
const COACH_STYLE_STORAGE_KEY = 'ai-coach-style-v1';
const HOME_PANELS = ['weight', 'water', 'sleep'] as const;
type HomePanel = (typeof HOME_PANELS)[number];
type CoachStyle = 'gentle' | 'strict';

const ESSENTIAL_MICRO_TARGETS = [
  { label: 'Vitamin A', target: 900, aliases: ['vitamin_a', 'vitamin a', 'retinol', 'vitamin a rae'] },
  { label: 'Vitamin C', target: 90, aliases: ['vitamin_c', 'vitamin c', 'ascorbic acid'] },
  { label: 'Vitamin D', target: 15, aliases: ['vitamin_d', 'vitamin d', 'vitamin d3', 'cholecalciferol'] },
  { label: 'Vitamin E', target: 15, aliases: ['vitamin_e', 'vitamin e', 'alpha tocopherol', 'tocopherol'] },
  { label: 'Vitamin B12', target: 2.4, aliases: ['vitamin_b12', 'vitamin b12', 'b12', 'cobalamin'] },
  { label: 'Folate', target: 400, aliases: ['folate', 'vitamin_b9', 'vitamin b9', 'folic acid', 'b9'] },
  { label: 'Calcium', target: 1000, aliases: ['calcium'] },
  { label: 'Magnesium', target: 400, aliases: ['magnesium'] },
  { label: 'Potassium', target: 4700, aliases: ['potassium'] },
  { label: 'Iron', target: 8, aliases: ['iron'] }
] as const;

function normalizeMicroKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function toMinutesFromTime(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getTimeOfDayLabel(hour: number) {
  if (hour < 11) return 'morning';
  if (hour < 16) return 'midday';
  if (hour < 21) return 'evening';
  return 'night';
}

function isHomePanel(value: string | null): value is HomePanel {
  return value !== null && HOME_PANELS.includes(value as HomePanel);
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { push } = useStackNavigation();
  const now = new Date();
  const today = useMemo(() => toYyyyMmDd(now), [now]);
  const weekStartIso = useMemo(() => getWeekStart(now).toISOString(), [now]);
  const [currentUserId, setCurrentUserId] = useState<string>('local-user');
  const [daySummary, setDaySummary] = useState('');
  const [activeHomePanel, setActiveHomePanel] = useState<HomePanel | null>(() => {
    const panelFromQuery = searchParams.get('panel');
    return isHomePanel(panelFromQuery) ? panelFromQuery : null;
  });
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
  const [coachStatus, setCoachStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [coachSuggestion, setCoachSuggestion] = useState<GeminiDailyCoachPayload | null>(null);
  const [coachError, setCoachError] = useState('');
  const [coachStyle, setCoachStyle] = useState<CoachStyle>('gentle');

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
    const [todayLogs, settings, workouts, profile] = await Promise.all([
      db.logs.where('date').equals(today).toArray(),
      db.settings.get(SETTINGS_ID as string) as Promise<SettingsRow | undefined>,
      db.workouts.toArray(),
      db.profiles.get(currentUserId) as Promise<Profile | undefined>
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
      profile,
      settings,
      todayLogs,
      foodsMap,
      todayLogsCount: todayLogs.length,
      calorieTotals,
      workouts,
      workoutsCount: workouts.length,
      todayWorkoutCount,
      thisWeekWorkoutsCount: thisWeekWorkouts.length,
      thisWeekMinutes
    };
  }, [today, weekStartIso, currentUserId]);

  const workoutProgressChart = useMemo(() => buildWorkoutProgressChart(data?.workouts ?? [], now), [data?.workouts, today]);
  const hasWorkoutProgressValues = useMemo(
    () => workoutProgressChart.buckets.some((bucket) => bucket.value > 0),
    [workoutProgressChart]
  );
  const workoutPeriodSummary = useMemo(() => {
    const workouts = data?.workouts ?? [];
    const nowStartMs = startOfDay(now).getTime();
    const last7DaysStartMs = addDays(startOfDay(now), -6).getTime();
    const threeMonthStartMs = addMonths(startOfMonth(now), -2).getTime();
    const sixMonthStartMs = addMonths(startOfMonth(now), -5).getTime();
    const yearStartMs = addMonths(startOfMonth(now), -11).getTime();

    const timestamps = workouts
      .map((workout) => new Date(workout.start_time).getTime())
      .filter((value) => Number.isFinite(value));

    return {
      week: timestamps.filter((value) => value >= last7DaysStartMs && value <= nowStartMs + 86400000).length,
      threeMonth: timestamps.filter((value) => value >= threeMonthStartMs && value <= nowStartMs + 86400000).length,
      sixMonth: timestamps.filter((value) => value >= sixMonthStartMs && value <= nowStartMs + 86400000).length,
      year: timestamps.filter((value) => value >= yearStartMs && value <= nowStartMs + 86400000).length
    };
  }, [data?.workouts, today]);

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
  const dietTags = data?.profile?.diet_tags ?? [];
  const allergies = [...(data?.profile?.allergies ?? []), ...(data?.profile?.custom_allergies ?? [])];
  const mealPattern = data?.profile?.meal_pattern ?? '';
  const goalFocus = data?.profile?.goal_focus ?? '';
  const activityLevel = data?.profile?.activity_level ?? '';
  const medicalConstraints = data?.profile?.medical_constraints ?? [];

  const coachContext = useMemo(() => {
    const logs = data?.todayLogs ?? [];
    const foodsMap = data?.foodsMap ?? {};
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const currentHour = now.getHours();

    const mealSettings = data?.settings?.meals ?? [];
    const expectedCaloriesByNow = mealSettings.reduce((sum, meal) => {
      const minutes = toMinutesFromTime(meal.time || '');
      if (minutes === null || minutes > nowMinutes) return sum;

      const targetValue = Number(meal.targetValue) || 0;
      if (targetValue <= 0) return sum;

      if (meal.targetMode === 'percent') {
        return sum + (calorieGoal * targetValue) / 100;
      }

      return sum + targetValue;
    }, 0);

    const expectedProgressPercent =
      expectedCaloriesByNow > 0
        ? Math.min(100, (expectedCaloriesByNow / Math.max(1, calorieGoal)) * 100)
        : Math.min(100, (nowMinutes / 1440) * 100);

    const actualProgressPercent = Math.min(100, (caloriesConsumed / Math.max(1, calorieGoal)) * 100);

    const macroExpected = {
      protein: (proteinGoal * expectedProgressPercent) / 100,
      carbs: (carbsGoal * expectedProgressPercent) / 100,
      fat: (fatGoal * expectedProgressPercent) / 100
    };

    const fiberGoalLocal = Math.max(0, data?.settings?.nutrition?.fiberGrams ?? 30);
    const microsConsumed: Record<string, number> = {};
    let fiberConsumed = 0;

    logs.forEach((log) => {
      const food = foodsMap[log.food_id];
      if (!food?.micros) return;
      const amount = Number(log.amount_consumed) || 0;
      if (amount <= 0) return;

      Object.entries(food.micros).forEach(([key, value]) => {
        const numericValue = (Number(value) || 0) * amount;
        if (numericValue <= 0) return;
        const normalized = normalizeMicroKey(key);
        if (/^fibre$|^fiber$|^dietary\s*fiber$/i.test(normalized)) {
          fiberConsumed += numericValue;
          return;
        }
        microsConsumed[normalized] = (microsConsumed[normalized] || 0) + numericValue;
      });
    });

    const topMicronutrientDeficits = ESSENTIAL_MICRO_TARGETS.map((target) => {
      const consumed = target.aliases.reduce((sum, alias) => sum + (microsConsumed[normalizeMicroKey(alias)] || 0), 0);
      return {
        nutrient: target.label,
        deficit: Math.max(0, Math.round((target.target - consumed) * 10) / 10)
      };
    })
      .filter((item) => item.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit)
      .slice(0, 5);

    const eaa = analyzeEaaRatio(
      logs.map((log) => {
        const food = foodsMap[log.food_id];
        return {
          proteinGrams: Number(food?.protein) || 0,
          amountConsumed: Number(log.amount_consumed) || 0,
          micros: food?.micros
        };
      })
    );

    const topEaaDeficits = Object.entries(eaa.deficitByGroup)
      .map(([group, value]) => ({ group, deficit: Math.round((value || 0) * 100) / 100 }))
      .filter((entry) => entry.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit)
      .slice(0, 2);

    const fastingWindowHint = getFastingWindowHint(mealPattern, mealSettings as any);
    const mealTimingAdvice = getMealTimingAdvice(mealSettings as any, mealPattern, fastingWindowHint);

    const delta7dKg =
      weightTrend.firstKg !== null && weightTrend.lastKg !== null
        ? Math.round((weightTrend.lastKg - weightTrend.firstKg) * 10) / 10
        : 0;

    return {
      timeOfDay: getTimeOfDayLabel(currentHour),
      expectedProgressPercent: Math.round(expectedProgressPercent),
      actualProgressPercent: Math.round(actualProgressPercent),
      caloriePacingDelta: Math.round((actualProgressPercent - expectedProgressPercent) * 10) / 10,
      macroPacingDelta: {
        protein: Math.round((proteinConsumed - macroExpected.protein) * 10) / 10,
        carbs: Math.round((carbsConsumed - macroExpected.carbs) * 10) / 10,
        fat: Math.round((fatConsumed - macroExpected.fat) * 10) / 10
      },
      fiber: {
        goal: Math.round(fiberGoalLocal),
        consumed: Math.round(fiberConsumed * 10) / 10,
        remaining: Math.max(0, Math.round((fiberGoalLocal - fiberConsumed) * 10) / 10)
      },
      eaaCoveragePercent: Math.round((eaa.proteinTotal > 0 ? (eaa.proteinWithEaaData / eaa.proteinTotal) * 100 : 0) * 10) / 10,
      topEaaDeficits,
      topMicronutrientDeficits,
      mealTiming: {
        score: mealTimingAdvice.score,
        summary: mealTimingAdvice.summary,
        advice: mealTimingAdvice.advice
      },
      weightTrend7d: {
        deltaKg: delta7dKg,
        distanceToGoalKg: distanceToGoalKg !== null ? Math.round(distanceToGoalKg * 10) / 10 : null,
        progressPercent: goalJourneyProgress !== null ? Math.round(goalJourneyProgress) : null
      }
    };
  }, [
    data?.todayLogs,
    data?.foodsMap,
    data?.settings?.meals,
    data?.settings?.nutrition?.fiberGrams,
    now,
    calorieGoal,
    caloriesConsumed,
    proteinGoal,
    carbsGoal,
    fatGoal,
    proteinConsumed,
    carbsConsumed,
    fatConsumed,
    mealPattern,
    weightTrend.firstKg,
    weightTrend.lastKg,
    distanceToGoalKg,
    goalJourneyProgress
  ]);

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

  useEffect(() => {
    const panelFromQuery = searchParams.get('panel');
    const nextPanel = isHomePanel(panelFromQuery) ? panelFromQuery : null;
    setActiveHomePanel((prev) => (prev === nextPanel ? prev : nextPanel));
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(COACH_STYLE_STORAGE_KEY);
    if (saved === 'strict' || saved === 'gentle') {
      setCoachStyle(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COACH_STYLE_STORAGE_KEY, coachStyle);
  }, [coachStyle]);

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

  const setPanelWithTransition = (panel: HomePanel | null, direction: 'forward' | 'backward') => {
    const shouldReplace = panel === null || (activeHomePanel !== null && panel !== null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (panel) {
          next.set('panel', panel);
        } else {
          next.delete('panel');
        }
        return next;
      },
      { replace: shouldReplace }
    );

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

  const generateCoachSuggestion = async () => {
    if (coachStatus === 'loading') return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setCoachError('You appear to be offline. Connect to the internet and try again.');
      setCoachStatus('error');
      return;
    }

    try {
      setCoachStatus('loading');
      setCoachError('');

      const suggestion = await fetchGeminiDailyCoach({
        date: today,
        caloriesGoal: Math.round(calorieGoal),
        caloriesConsumed,
        proteinGoal,
        proteinConsumed,
        carbsGoal,
        carbsConsumed,
        fatGoal,
        fatConsumed,
        waterGoal,
        waterToday: Math.round(todayWater),
        sleepGoal,
        sleepToday: Math.round(todaySleep * 10) / 10,
        workoutsToday: data?.todayWorkoutCount ?? 0,
        workoutMinutesWeek: data?.thisWeekMinutes ?? 0,
        todayLogsCount: data?.todayLogsCount ?? 0,
        dietTags,
        allergies,
        mealPattern,
        goalFocus,
        activityLevel,
        medicalConstraints,
        daySummary: daySummary.trim().slice(0, 280),
        coachStyle,
        ...coachContext
      });

      setCoachSuggestion({
        ...suggestion,
        why: (suggestion.why ?? []).slice(0, 3)
      });
      setCoachStatus('ready');
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to load AI suggestion';
      const message = /invalid action/i.test(rawMessage)
        ? 'AI coach is not deployed on the server yet. Deploy the updated gemini-food-nutrition edge function and retry.'
        : rawMessage;
      setCoachError(message);
      setCoachStatus('error');
    }
  };

  if (activeHomePanel === 'weight') {
    return (
      <div className="bg-page font-sans">
        <RouteHeader title="Weight log" onBack={() => setPanelWithTransition(null, 'backward')} />

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
      <div className="bg-page font-sans">
        <RouteHeader title="Water tracker" onBack={() => setPanelWithTransition(null, 'backward')} />

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
      <div className="bg-page font-sans">
        <RouteHeader title="Sleep tracker" onBack={() => setPanelWithTransition(null, 'backward')} />

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
    <div className="bg-page font-sans">
      <RouteHeader title="Dashboard" />

      <main className="max-w-md mx-auto p-4 space-y-4">
        <button
          type="button"
          onClick={() => push('/log')}
          className="block w-full bg-card rounded-2xl p-6 border border-border-subtle shadow-sm hover:border-brand-light transition-all active:scale-[0.99]"
        >
          <p className="mt-2 text-3xl text-text-main leading-tight whitespace-nowrap">
            <span className="font-extrabold">{caloriesConsumed}</span>
            <span className="text-text-muted font-normal"> / {Math.round(calorieGoal)}</span>{' '}
            <span className="text-sm font-semibold text-text-muted align-middle">Calories Eaten</span>
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
          className="block w-full bg-card rounded-2xl p-5 border border-border-subtle shadow-sm hover:border-brand-light transition-all active:scale-[0.99]"
        >
          <p className="text-xs text-text-muted">{workoutPeriodSummary.week} workouts in last 7 days</p>
          {hasWorkoutProgressValues ? (
            <div className="mt-3 flex h-24 items-end gap-1.5">
              {workoutProgressChart.buckets.map((bucket) => {
                const heightPercent = bucket.value > 0 ? Math.max(8, (bucket.value / workoutProgressChart.maxValue) * 100) : 0;
                return (
                  <div key={bucket.id} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div className="flex h-20 w-full items-end">
                      {bucket.value > 0 ? <div className="w-full rounded-t-md bg-brand" style={{ height: `${heightPercent}%` }} /> : null}
                    </div>
                    <p className="truncate text-[10px] text-text-muted">{bucket.label}</p>
                  </div>
                );
              })}
            </div>
          ) : null}
        </button>

        <section className="bg-card rounded-2xl p-5 border border-border-subtle shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-text-muted">AI coach</p>
              <p className="text-xs text-text-muted mt-1">Runs only when you tap the button</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <select
                value={coachStyle}
                onChange={(event) => setCoachStyle(event.target.value as CoachStyle)}
                className="rounded-lg border border-border-subtle bg-surface px-2 py-1 text-[11px] text-text-main"
              >
                <option value="gentle">Gentle coach</option>
                <option value="strict">Strict coach</option>
              </select>
              <button
                type="button"
                onClick={() => void generateCoachSuggestion()}
                disabled={coachStatus === 'loading'}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-fg disabled:opacity-60"
              >
                {coachStatus === 'loading' ? 'Loading...' : coachStatus === 'ready' ? 'Refresh suggestion' : 'Get AI suggestion'}
              </button>
            </div>
          </div>

          {coachStatus === 'idle' ? (
            <p className="text-xs text-text-muted mt-3">No AI calls yet today. Tap “Get AI suggestion” when you want one.</p>
          ) : null}

          {coachStatus === 'error' ? (
            <div className="mt-3 rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
              <p className="text-xs font-semibold text-text-main">Couldn’t generate suggestion</p>
              <p className="text-xs text-text-muted mt-1">{coachError || 'Please try again in a moment.'}</p>
            </div>
          ) : null}

          {coachStatus === 'ready' && coachSuggestion ? (
            <div className="mt-3 space-y-2">
              <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Suggestion</p>
                <p className="text-sm font-semibold text-text-main mt-1">{coachSuggestion.suggestion_title || 'Daily suggestion'}</p>
                <p className="text-xs text-text-muted mt-1">{coachSuggestion.suggestion_text || 'No suggestion text returned.'}</p>
              </div>

              {coachSuggestion.warning_text ? (
                <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Warning</p>
                  <p className="text-xs text-text-main mt-1">{coachSuggestion.warning_text}</p>
                </div>
              ) : null}

              <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Food / recipe</p>
                <p className="text-xs text-text-main mt-1">{coachSuggestion.food_or_recipe || 'No food suggestion returned.'}</p>
              </div>

              {coachSuggestion.why?.length ? (
                <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Why this</p>
                  <ul className="mt-1 space-y-1">
                    {coachSuggestion.why.map((reason, index) => (
                      <li key={`${reason}-${index}`} className="text-xs text-text-main">
                        • {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

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