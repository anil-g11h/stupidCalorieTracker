import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ForkKnifeIcon as Utensils,
  CaretLeftIcon as ChevronLeft,
  CaretRightIcon as ChevronRight,
  CalendarIcon as Calendar,
  ChartLineUpIcon as AnalyticsIcon
} from '@phosphor-icons/react';
import { useSearchParams, Link } from 'react-router-dom';
import { db, type BodyMetric, type DailyLog, type Food, type Profile } from '../lib/db';
import { generateId } from '../lib';
import { analyzeEaaRatio } from '../lib/eaa';
import RouteHeader from '../lib/components/RouteHeader';

const SETTINGS_KEY = 'stupid_tracker_settings_v1';
const SETTINGS_ID = 'local-settings';
const DEFAULT_MEAL_IDS = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement'] as const;
const CANONICAL_MEAL_IDS = new Set(DEFAULT_MEAL_IDS);
const WEIGHT_BASED_REGEX = /^(g|ml|oz)$/i;
const FIBER_KEY_REGEX = /^fibre$|^fiber$|^dietary[_\s-]*fiber$/i;

type MacroTabKey = 'protein' | 'carbs' | 'fat' | 'fiber';
type AminoTrackingMode = 'who' | 'hypertrophy';

interface WhoAminoTarget {
  key: string;
  label: string;
  mgPerKgDay: number;
  aliases: string[];
}

const WHO_AMINO_TARGETS: WhoAminoTarget[] = [
  { key: 'histidine10', label: 'Histidine', mgPerKgDay: 10, aliases: ['histidine', 'l-histidine'] },
  { key: 'isoleucine20', label: 'Isoleucine', mgPerKgDay: 20, aliases: ['isoleucine', 'l-isoleucine'] },
  { key: 'leucine39', label: 'Leucine', mgPerKgDay: 39, aliases: ['leucine', 'l-leucine', 'leu'] },
  { key: 'lysine30', label: 'Lysine', mgPerKgDay: 30, aliases: ['lysine', 'l-lysine', 'lys'] },
  {
    key: 'methionine_cysteine15',
    label: 'Methionine + Cysteine',
    mgPerKgDay: 15,
    aliases: ['methionine', 'l-methionine', 'cysteine', 'l-cysteine']
  },
  {
    key: 'phenylalanine_tyrosine25',
    label: 'Phenylalanine + Tyrosine',
    mgPerKgDay: 25,
    aliases: ['phenylalanine', 'l-phenylalanine', 'tyrosine', 'l-tyrosine']
  },
  { key: 'threonine15', label: 'Threonine', mgPerKgDay: 15, aliases: ['threonine', 'l-threonine'] },
  { key: 'tryptophan4', label: 'Tryptophan', mgPerKgDay: 4, aliases: ['tryptophan', 'l-tryptophan'] },
  { key: 'valine26', label: 'Valine', mgPerKgDay: 26, aliases: ['valine', 'l-valine'] }
];

const HYPERTROPHY_MEAL_LEUCINE_TARGET = 3;
const HYPERTROPHY_MEAL_EAA_TARGET = 12;

type MealTargetMode = 'percent' | 'calories';

interface TrackerNutrition {
  calorieBudget: number;
  proteinPercent: number;
  carbPercent: number;
  fatPercent: number;
  fiberGrams: number;
}

interface TrackerMealSetting {
  id: string;
  name: string;
  time?: string;
  targetMode: MealTargetMode;
  targetValue: number;
}

interface TrackerSettings {
  nutrition: TrackerNutrition;
  meals: TrackerMealSetting[];
}

interface ExtendedLog extends DailyLog {
  food?: Food;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface MealDefinition {
  id: string;
  name: string;
  time?: string;
  targetMode?: MealTargetMode;
  targetValue?: number;
  aliases: Set<string>;
}

interface MealSection {
  id: string;
  label: string;
  time?: string;
  targetKcal?: number;
  logs: ExtendedLog[];
}

interface MoveMealOption {
  id: string;
  label: string;
}

type NutrientUnit = 'mg' | 'mcg' | 'IU';

interface NutrientTarget {
  key: string;
  label: string;
  unit: NutrientUnit;
  target: number;
  max?: number;
  functionText: string;
  aliases: string[];
}

const ESSENTIAL_VITAMINS: NutrientTarget[] = [
  {
    key: 'vitamin_a',
    label: 'Vitamin A',
    unit: 'mcg',
    target: 900,
    functionText: 'Eye health and night vision',
    aliases: ['vitamin_a', 'vitamin a', 'retinol', 'vitamin a rae']
  },
  {
    key: 'vitamin_c',
    label: 'Vitamin C',
    unit: 'mg',
    target: 90,
    functionText: 'Antioxidant and immune support',
    aliases: ['vitamin_c', 'vitamin c', 'ascorbic acid']
  },
  {
    key: 'vitamin_d',
    label: 'Vitamin D',
    unit: 'mcg',
    target: 15,
    functionText: 'Calcium absorption and bone strength',
    aliases: ['vitamin_d', 'vitamin d', 'vitamin d3', 'cholecalciferol']
  },
  {
    key: 'vitamin_e',
    label: 'Vitamin E',
    unit: 'mg',
    target: 15,
    functionText: 'Cell protection from free radicals',
    aliases: ['vitamin_e', 'vitamin e', 'alpha tocopherol', 'tocopherol']
  },
  {
    key: 'vitamin_b12',
    label: 'Vitamin B12',
    unit: 'mcg',
    target: 2.4,
    functionText: 'Nerve function and red blood cell formation',
    aliases: ['vitamin_b12', 'vitamin b12', 'b12', 'cobalamin']
  },
  {
    key: 'vitamin_b6',
    label: 'Vitamin B6',
    unit: 'mg',
    target: 1.3,
    functionText: 'Mood regulation and energy metabolism',
    aliases: ['vitamin_b6', 'vitamin b6', 'b6', 'pyridoxine']
  },
  {
    key: 'folate_b9',
    label: 'Folate (B9)',
    unit: 'mcg',
    target: 400,
    functionText: 'Cell division and DNA synthesis',
    aliases: ['folate', 'vitamin_b9', 'vitamin b9', 'folic acid', 'b9']
  }
];

const ESSENTIAL_MINERALS: NutrientTarget[] = [
  {
    key: 'calcium',
    label: 'Calcium',
    unit: 'mg',
    target: 1000,
    functionText: 'Bone and teeth structure',
    aliases: ['calcium']
  },
  {
    key: 'magnesium',
    label: 'Magnesium',
    unit: 'mg',
    target: 400,
    functionText: 'Muscle relaxation and 300+ metabolic reactions',
    aliases: ['magnesium']
  },
  {
    key: 'potassium',
    label: 'Potassium',
    unit: 'mg',
    target: 4700,
    functionText: 'Fluid balance and healthy blood pressure',
    aliases: ['potassium']
  },
  {
    key: 'zinc',
    label: 'Zinc',
    unit: 'mg',
    target: 11,
    functionText: 'Hormone regulation and testosterone support',
    aliases: ['zinc']
  },
  {
    key: 'iron',
    label: 'Iron',
    unit: 'mg',
    target: 8,
    functionText: 'Oxygen transport in the blood',
    aliases: ['iron']
  },
  {
    key: 'sodium',
    label: 'Sodium',
    unit: 'mg',
    target: 1500,
    max: 2300,
    functionText: 'Nerve impulses and fluid balance',
    aliases: ['sodium', 'na']
  },
  {
    key: 'iodine',
    label: 'Iodine',
    unit: 'mcg',
    target: 150,
    functionText: 'Thyroid hormone production',
    aliases: ['iodine']
  }
];

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAminoKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, '');
}

function canonicalMealIdFromName(name: string): string | null {
  const normalized = normalizeKey(name);
  if (!normalized) return null;
  if (normalized.includes('break')) return 'breakfast';
  if (normalized.includes('lunch')) return 'lunch';
  if (normalized.includes('dinner') || normalized.includes('supper')) return 'dinner';
  if (normalized.includes('snack')) return 'snack';
  if (normalized.includes('supplement') || normalized.includes('vitamin')) return 'supplement';
  return null;
}

function normalizeMealId(meal: { id?: string; name?: string }, index: number, usedCanonicalMealIds: Set<string>): string {
  const rawId = normalizeKey(meal.id || '');
  if (rawId) {
    if (!CANONICAL_MEAL_IDS.has(rawId)) return rawId;
    if (!usedCanonicalMealIds.has(rawId)) {
      usedCanonicalMealIds.add(rawId);
      return rawId;
    }
  }

  const canonicalFromName = canonicalMealIdFromName(meal.name || '');
  if (canonicalFromName && !usedCanonicalMealIds.has(canonicalFromName)) {
    usedCanonicalMealIds.add(canonicalFromName);
    return canonicalFromName;
  }

  if (index === 0 && !usedCanonicalMealIds.has('breakfast')) {
    usedCanonicalMealIds.add('breakfast');
    return 'breakfast';
  }
  if (index === 1 && !usedCanonicalMealIds.has('lunch')) {
    usedCanonicalMealIds.add('lunch');
    return 'lunch';
  }
  if (index === 2 && !usedCanonicalMealIds.has('dinner')) {
    usedCanonicalMealIds.add('dinner');
    return 'dinner';
  }
  if (index === 3 && !usedCanonicalMealIds.has('snack')) {
    usedCanonicalMealIds.add('snack');
    return 'snack';
  }

  return rawId || generateId();
}

function normalizeServingUnitLabel(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return 'gram';
  if (normalized === 'g' || normalized === 'gram' || normalized === 'grams') return 'gram';
  return normalized;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleize(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatNutrientAmount(value: number, unit: NutrientUnit): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

function buildNormalizedMicrosMap(microsConsumed: Record<string, number>): Record<string, number> {
  return Object.entries(microsConsumed).reduce<Record<string, number>>((acc, [key, value]) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || value <= 0) return acc;
    acc[normalizedKey] = (acc[normalizedKey] || 0) + value;
    return acc;
  }, {});
}

function getNutrientConsumed(normalizedMicros: Record<string, number>, aliases: string[]): number {
  return aliases.reduce((sum, alias) => sum + (normalizedMicros[normalizeKey(alias)] || 0), 0);
}

function getMetricCreatedAtTime(value: BodyMetric['created_at']): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toKg(value: number, unit: string): number {
  if (!Number.isFinite(value)) return 0;
  const normalizedUnit = normalizeKey(unit || '');
  if (!normalizedUnit || normalizedUnit === 'kg' || normalizedUnit === 'kgs' || normalizedUnit === 'kilogram' || normalizedUnit === 'kilograms') {
    return value;
  }
  if (normalizedUnit === 'lb' || normalizedUnit === 'lbs' || normalizedUnit === 'pound' || normalizedUnit === 'pounds') {
    return value / 2.20462;
  }
  if (normalizedUnit === 'g' || normalizedUnit === 'gram' || normalizedUnit === 'grams') {
    return value / 1000;
  }
  return value;
}

function getAminoGramsFromMicros(
  micros: Record<string, number> | undefined,
  aliases: string[],
  amountConsumed: number
): number {
  if (!micros || !Number.isFinite(amountConsumed) || amountConsumed <= 0) return 0;

  const aliasSet = new Set(aliases.map(normalizeAminoKey));

  return Object.entries(micros).reduce((sum, [key, value]) => {
    if (!aliasSet.has(normalizeAminoKey(key))) return sum;
    const grams = (Number(value) || 0) * amountConsumed;
    if (grams <= 0) return sum;
    return sum + grams;
  }, 0);
}

function getLogLeucineGrams(log: ExtendedLog): number {
  const leucineAliases = WHO_AMINO_TARGETS.find((item) => item.key === 'leucine39')?.aliases ?? ['leucine', 'l-leucine', 'leu'];
  return getAminoGramsFromMicros(log.food?.micros, leucineAliases, Number(log.amount_consumed) || 0);
}

function getLogTotalEaaGrams(log: ExtendedLog): number {
  const amountConsumed = Number(log.amount_consumed) || 0;
  return WHO_AMINO_TARGETS.reduce((sum, aminoTarget) => {
    return sum + getAminoGramsFromMicros(log.food?.micros, aminoTarget.aliases, amountConsumed);
  }, 0);
}

function parseTrackerSettings(raw: unknown): TrackerSettings | null {
  if (!raw) return null;

  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<TrackerSettings>;
    const nutritionRaw = parsed?.nutrition;

    if (!nutritionRaw || typeof nutritionRaw !== 'object') return null;

    const calorieBudget = toNumber(nutritionRaw.calorieBudget);
    const proteinPercent = toNumber(nutritionRaw.proteinPercent);
    const carbPercent = toNumber(nutritionRaw.carbPercent);
    const fatPercent = toNumber(nutritionRaw.fatPercent);
    const fiberGrams = toNumber(nutritionRaw.fiberGrams);

    if (
      calorieBudget === undefined ||
      proteinPercent === undefined ||
      carbPercent === undefined ||
      fatPercent === undefined ||
      fiberGrams === undefined
    ) {
      return null;
    }

    const usedCanonicalMealIds = new Set<string>();

    const meals = Array.isArray(parsed.meals)
      ? parsed.meals
          .map((meal, index) => {
            const id = normalizeMealId({ id: typeof meal?.id === 'string' ? meal.id : '', name: typeof meal?.name === 'string' ? meal.name : '' }, index, usedCanonicalMealIds);
            if (!id) return null;

            const name = typeof meal?.name === 'string' && meal.name.trim() ? meal.name.trim() : titleize(id);
            const time = typeof meal?.time === 'string' && meal.time.trim() ? meal.time.trim() : undefined;
            const targetMode: MealTargetMode = meal?.targetMode === 'percent' ? 'percent' : 'calories';
            const targetValue = toNumber(meal?.targetValue) ?? 0;

            return { id, name, time, targetMode, targetValue } satisfies TrackerMealSetting;
          })
          .filter(Boolean) as TrackerMealSetting[]
      : [];

    return {
      nutrition: {
        calorieBudget: Math.max(0, Math.round(calorieBudget)),
        proteinPercent: Math.max(0, proteinPercent),
        carbPercent: Math.max(0, carbPercent),
        fatPercent: Math.max(0, fatPercent),
        fiberGrams: Math.max(0, fiberGrams)
      },
      meals
    };
  } catch {
    return null;
  }
}

function readSettingsFromLocalStorage(): TrackerSettings | null {
  if (typeof window === 'undefined') return null;
  return parseTrackerSettings(window.localStorage.getItem(SETTINGS_KEY));
}

async function readSettingsFromDb(): Promise<TrackerSettings | null> {
  try {
    const row = await db.settings.get(SETTINGS_ID);
    return parseTrackerSettings(row);
  } catch {
    return null;
  }
}

function buildMealDefinitionFromSetting(setting: TrackerMealSetting): MealDefinition {
  const id = setting.id.trim();
  const name = setting.name.trim() || titleize(id);

  const aliases = new Set<string>();
  const idNorm = normalizeKey(id);
  const nameNorm = normalizeKey(name);
  const nameSlug = slugify(nameNorm);
  const nameUnderscore = nameNorm.replace(/\s+/g, '_');
  const nameDash = nameNorm.replace(/\s+/g, '-');

  [idNorm, nameNorm, nameSlug, nameUnderscore, nameDash].forEach((alias) => {
    if (alias) aliases.add(alias);
  });

  return {
    id,
    name,
    time: setting.time,
    targetMode: setting.targetMode,
    targetValue: setting.targetValue,
    aliases
  };
}

function getDefaultMeals(): MealDefinition[] {
  return DEFAULT_MEAL_IDS.map((mealId) => {
    const id = String(mealId);
    return buildMealDefinitionFromSetting({
      id,
      name: titleize(id),
      targetMode: 'calories',
      targetValue: 0
    });
  });
}

function getNutritionGoals(
  settings: TrackerSettings | null,
  fallback: { calories: number; protein: number; carbs: number; fat: number }
) {
  if (!settings) return fallback;

  const calories = Math.max(1, Math.round(settings.nutrition.calorieBudget));
  const protein = Math.round((calories * (settings.nutrition.proteinPercent / 100)) / 4);
  const carbs = Math.round((calories * (settings.nutrition.carbPercent / 100)) / 4);
  const fat = Math.round((calories * (settings.nutrition.fatPercent / 100)) / 9);

  return { calories, protein, carbs, fat };
}

function resolveMealTargetKcal(
  meal: Pick<MealDefinition, 'targetMode' | 'targetValue'>,
  calorieBudget: number
): number | undefined {
  if (meal.targetValue === undefined || !Number.isFinite(meal.targetValue) || meal.targetValue <= 0) {
    return undefined;
  }

  if (meal.targetMode === 'percent') {
    return Math.round((calorieBudget * meal.targetValue) / 100);
  }

  return Math.round(meal.targetValue);
}

function parseMealTimeToMinutes(time?: string): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function circularMinuteDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

export default function DailyLogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [settings, setSettings] = useState<TrackerSettings | null>(() => readSettingsFromLocalStorage());
  const [activeMacroTab, setActiveMacroTab] = useState<MacroTabKey>('protein');
  const [timeTick, setTimeTick] = useState(() => Date.now());
  const [openActionsLogId, setOpenActionsLogId] = useState<string | null>(null);

  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const activePanel = searchParams.get('panel');
  const isReportView = activePanel === 'report';
  const showAnalytics = isReportView;
  const isToday = date === new Date().toISOString().split('T')[0];

  useEffect(() => {
    const refreshSettings = async () => {
      const dbSettings = await readSettingsFromDb();
      if (dbSettings) {
        setSettings(dbSettings);
        return;
      }

      setSettings(readSettingsFromLocalStorage());
    };

    void refreshSettings();
    const handleRefresh = () => {
      void refreshSettings();
    };

    window.addEventListener('storage', handleRefresh);
    window.addEventListener('focus', handleRefresh);

    return () => {
      window.removeEventListener('storage', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
    };
  }, []);

  useEffect(() => {
    if (!isToday) return;

    const interval = window.setInterval(() => {
      setTimeTick(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isToday]);

  const displayDate = useMemo(
    () =>
      new Date(date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }),
    [date]
  );

  const changeDate = (days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('date', next.toISOString().split('T')[0]);
    setSearchParams(nextParams);
  };

  const setPanelWithTransition = (panel: 'report' | null, direction: 'forward' | 'backward') => {
    const shouldReplace = panel === null;
    const updatePanel = () => {
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
    };

    if (!document.startViewTransition) {
      updatePanel();
      return;
    }

    document.documentElement.classList.add(`transition-${direction}`);
    const transition = document.startViewTransition(() => {
      updatePanel();
    });
    transition.finished.finally(() => {
      document.documentElement.classList.remove(`transition-${direction}`);
    });
  };

  const data = useLiveQuery(async () => {
    const daysLogs = await db.logs.where('date').equals(date).toArray();
    const foodIds = [...new Set(daysLogs.map((log) => log.food_id))];
    const foods = foodIds.length ? await db.foods.where('id').anyOf(foodIds).toArray() : [];
    const settingsRow = await db.settings.get(SETTINGS_ID);

    const foodsMap = foods.reduce<Record<string, Food>>((acc, food) => {
      acc[food.id] = food;
      return acc;
    }, {});

    return { daysLogs, foodsMap, settingsRow };
  }, [date]);

  const currentUserId = useMemo(() => {
    const fromLogs = data?.daysLogs.find((log) => typeof log.user_id === 'string' && log.user_id.trim())?.user_id?.trim();
    return fromLogs || 'local-user';
  }, [data]);

  const profileRow = useLiveQuery(
    async () => {
      if (!currentUserId) return undefined;
      return db.profiles.get(currentUserId);
    },
    [currentUserId],
    undefined as Profile | undefined
  );

  const aminoMode: AminoTrackingMode = profileRow?.goal_focus === 'muscle_gain' ? 'hypertrophy' : 'who';

  const latestWeightMetric = useLiveQuery(
    async () => {
      const list = await db.metrics
        .where('type')
        .equals('weight')
        .and((metric) => metric.user_id === currentUserId && metric.date <= date)
        .toArray();

      if (!list.length) return null;

      return list.sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1;
        return getMetricCreatedAtTime(b.created_at) - getMetricCreatedAtTime(a.created_at);
      })[0];
    },
    [currentUserId, date],
    null as BodyMetric | null
  );

  const latestWeightKg = useMemo(() => {
    if (!latestWeightMetric) return 0;
    return toKg(Number(latestWeightMetric.value) || 0, latestWeightMetric.unit || 'kg');
  }, [latestWeightMetric]);

  const baseGoals = {
    calories: Number((data as any)?.settingsRow?.nutrition?.calorieBudget) || 2000,
    protein:
      Number((data as any)?.settingsRow?.nutrition?.proteinTargetGrams) ||
      Math.round(((Number((data as any)?.settingsRow?.nutrition?.calorieBudget) || 2000) * ((Number((data as any)?.settingsRow?.nutrition?.proteinPercent) || 30) / 100)) / 4),
    carbs:
      Number((data as any)?.settingsRow?.nutrition?.carbsTargetGrams) ||
      Math.round(((Number((data as any)?.settingsRow?.nutrition?.calorieBudget) || 2000) * ((Number((data as any)?.settingsRow?.nutrition?.carbPercent) || 40) / 100)) / 4),
    fat:
      Number((data as any)?.settingsRow?.nutrition?.fatTargetGrams) ||
      Math.round(((Number((data as any)?.settingsRow?.nutrition?.calorieBudget) || 2000) * ((Number((data as any)?.settingsRow?.nutrition?.fatPercent) || 30) / 100)) / 9)
  };

  const goals = useMemo(
    () => getNutritionGoals(settings, baseGoals),
    [settings, baseGoals.calories, baseGoals.protein, baseGoals.carbs, baseGoals.fat]
  );

  const extendedLogs = useMemo<ExtendedLog[]>(() => {
    if (!data) return [];

    return data.daysLogs.map((log) => {
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

  const dailyTotals = useMemo(
    () =>
      extendedLogs.reduce(
        (acc, log) => ({
          calories: acc.calories + log.calories,
          protein: acc.protein + log.protein,
          carbs: acc.carbs + log.carbs,
          fat: acc.fat + log.fat
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [extendedLogs]
  );

  const caloriePercent = Math.min((dailyTotals.calories / Math.max(goals.calories, 1)) * 100, 100);
  const caloriePercentRaw = (dailyTotals.calories / Math.max(goals.calories, 1)) * 100;
  const remainingCalories = Math.round(goals.calories - dailyTotals.calories);
  const fiberGoal = Math.max(0, settings?.nutrition?.fiberGrams ?? 30);

  const analytics = useMemo(() => {
    const totals = {
      protein: dailyTotals.protein,
      carbs: dailyTotals.carbs,
      fat: dailyTotals.fat,
      fiber: 0
    };

    const microsConsumed: Record<string, number> = {};

    extendedLogs.forEach((log) => {
      const micros = log.food?.micros;
      if (!micros) return;

      Object.entries(micros).forEach(([key, value]) => {
        const amount = (Number(value) || 0) * (Number(log.amount_consumed) || 0);
        if (amount <= 0) return;

        if (FIBER_KEY_REGEX.test(key.trim())) {
          totals.fiber += amount;
        } else {
          microsConsumed[key] = (microsConsumed[key] || 0) + amount;
        }
      });
    });

    const microsList = Object.entries(microsConsumed)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);

    const eaa = analyzeEaaRatio(
      extendedLogs.map((log) => ({
        proteinGrams: Number(log.food?.protein) || 0,
        amountConsumed: Number(log.amount_consumed) || 0,
        micros: log.food?.micros
      }))
    );

    const eaaCoveragePercent = eaa.proteinTotal > 0 ? (eaa.proteinWithEaaData / eaa.proteinTotal) * 100 : 0;

    return {
      totals,
      microsConsumed,
      microsList,
      eaa,
      eaaCoveragePercent,
      remaining: {
        protein: Math.max(0, goals.protein - totals.protein),
        carbs: Math.max(0, goals.carbs - totals.carbs),
        fat: Math.max(0, goals.fat - totals.fat),
        fiber: Math.max(0, fiberGoal - totals.fiber)
      }
    };
  }, [dailyTotals, extendedLogs, goals.protein, goals.carbs, goals.fat, fiberGoal]);

  const macroContributors = useMemo(() => {
    const byFood = new Map<string, {
      id: string;
      name: string;
      protein: number;
      carbs: number;
      fat: number;
      fiber: number;
      loggedAmount: number;
      loggedUnit: string;
      loggedCalories: number;
    }>();

    extendedLogs.forEach((log) => {
      const amount = Number(log.amount_consumed) || 0;
      if (amount <= 0) return;

      const fallbackKey = `unknown-${(log.food?.name || 'food').trim().toLowerCase() || 'food'}`;
      const foodKey = (typeof log.food_id === 'string' && log.food_id.trim()) ? log.food_id.trim() : fallbackKey;
      const name = log.food?.name || 'Unknown Food';

      const existing = byFood.get(foodKey) ?? {
        id: foodKey,
        name,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        loggedAmount: 0,
        loggedUnit: typeof log.food?.serving_unit === 'string' && log.food.serving_unit.trim() ? log.food.serving_unit : 'gram',
        loggedCalories: 0
      };

      existing.protein += (Number(log.food?.protein) || 0) * amount;
      existing.carbs += (Number(log.food?.carbs) || 0) * amount;
      existing.fat += (Number(log.food?.fat) || 0) * amount;
      existing.loggedCalories += Number(log.calories) || 0;

      const servingSize = Number(log.food?.serving_size) || 0;
      if (servingSize > 0 && typeof log.food?.serving_unit === 'string' && log.food.serving_unit.trim()) {
        existing.loggedAmount += servingSize * amount;
        existing.loggedUnit = log.food.serving_unit;
      } else {
        existing.loggedAmount += amount;
      }

      const micros = log.food?.micros;
      if (micros) {
        Object.entries(micros).forEach(([key, value]) => {
          if (!FIBER_KEY_REGEX.test(key.trim())) return;
          const fiberAmount = (Number(value) || 0) * amount;
          if (fiberAmount > 0) {
            existing.fiber += fiberAmount;
          }
        });
      }

      byFood.set(foodKey, existing);
    });

    return [...byFood.values()];
  }, [extendedLogs]);

  const macroTabConfig: { key: MacroTabKey; label: string }[] = [
    { key: 'protein', label: 'Protein' },
    { key: 'carbs', label: 'Carbs' },
    { key: 'fat', label: 'Fat' },
    { key: 'fiber', label: 'Fiber' }
  ];

  const selectedMacroContributors = useMemo(() => {
    return macroContributors
      .map((item) => ({
        id: item.id,
        name: item.name,
        grams: item[activeMacroTab],
        loggedAmount: item.loggedAmount,
        loggedUnit: item.loggedUnit,
        loggedCalories: item.loggedCalories
      }))
      .filter((item) => item.grams > 0)
      .sort((a, b) => b.grams - a.grams);
  }, [macroContributors, activeMacroTab]);

  const micronutrientTracking = useMemo(() => {
    const normalizedMicros = buildNormalizedMicrosMap(analytics.microsConsumed);

    const mapTarget = (nutrient: NutrientTarget) => {
      const consumed = getNutrientConsumed(normalizedMicros, nutrient.aliases);
      const progress = Math.min((consumed / Math.max(nutrient.target, 1)) * 100, 100);
      const targetLabel = nutrient.max
        ? `${formatNutrientAmount(nutrient.target, nutrient.unit)} - ${formatNutrientAmount(nutrient.max, nutrient.unit)}`
        : formatNutrientAmount(nutrient.target, nutrient.unit);
      const status = nutrient.max
        ? consumed > nutrient.max
          ? `${formatNutrientAmount(consumed - nutrient.max, nutrient.unit)} above range`
          : consumed < nutrient.target
            ? `${formatNutrientAmount(nutrient.target - consumed, nutrient.unit)} to minimum`
            : 'Within target range'
        : consumed >= nutrient.target
          ? 'Goal met'
          : `${formatNutrientAmount(nutrient.target - consumed, nutrient.unit)} remaining`;

      return {
        ...nutrient,
        consumed,
        progress,
        targetLabel,
        status
      };
    };

    const vitamins = ESSENTIAL_VITAMINS.map(mapTarget);
    const minerals = ESSENTIAL_MINERALS.map(mapTarget);
    const trackedCount = [...vitamins, ...minerals].filter((item) => item.consumed > 0).length;

    return { vitamins, minerals, trackedCount };
  }, [analytics.microsConsumed]);

  const mealDefinitions = useMemo<MealDefinition[]>(() => {
    const configuredMeals = settings?.meals?.length
      ? settings.meals.map(buildMealDefinitionFromSetting)
      : getDefaultMeals();

    const hasSupplementMeal = configuredMeals.some((meal) => normalizeKey(meal.id) === 'supplement');
    if (hasSupplementMeal) return configuredMeals;

    return [
      ...configuredMeals,
      buildMealDefinitionFromSetting({
        id: 'supplement',
        name: 'Supplement',
        targetMode: 'calories',
        targetValue: 0
      })
    ];
  }, [settings]);

  const mealSections = useMemo<MealSection[]>(() => {
    const matchedLogIds = new Set<string>();

    const configuredSectionsWithOrder = mealDefinitions.map((meal, index) => {
      const logs = extendedLogs.filter((log) => {
        const logMeal = normalizeKey(log.meal_type || '');
        const isMatch = meal.aliases.has(logMeal);
        if (isMatch) matchedLogIds.add(log.id);
        return isMatch;
      });

      return {
        order: index,
        section: {
          id: meal.id,
          label: meal.name,
          time: meal.time,
          targetKcal: resolveMealTargetKcal(meal, goals.calories),
          logs
        } satisfies MealSection
      };
    });

    const configuredSections: MealSection[] = configuredSectionsWithOrder
      .sort((a, b) => {
        const aMinutes = parseMealTimeToMinutes(a.section.time);
        const bMinutes = parseMealTimeToMinutes(b.section.time);

        if (aMinutes !== null && bMinutes !== null) {
          return aMinutes - bMinutes;
        }

        if (aMinutes !== null) return -1;
        if (bMinutes !== null) return 1;

        return a.order - b.order;
      })
      .map((item) => item.section);

    const legacyMealTypes = [...new Set(
      extendedLogs
        .filter((log) => !matchedLogIds.has(log.id))
        .map((log) => log.meal_type)
        .filter((value): value is string => Boolean(value))
    )];

    const legacySections: MealSection[] = legacyMealTypes.map((legacyMealType) => ({
      id: legacyMealType,
      label: titleize(legacyMealType),
      logs: extendedLogs.filter((log) => normalizeKey(log.meal_type) === normalizeKey(legacyMealType))
    }));

    return [...configuredSections, ...legacySections];
  }, [extendedLogs, mealDefinitions, goals.calories]);

  const supplementFoods = useLiveQuery(async () => {
    const foods = await db.foods
      .filter((food) => Boolean(food.is_supplement))
      .toArray();

    return foods.sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const supplementLogIdsByFood = useMemo(() => {
    const logs = extendedLogs
      .filter((log) => normalizeKey(log.meal_type || '') === 'supplement')
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTs - aTs;
      });

    return logs.reduce<Map<string, string[]>>((acc, log) => {
      const ids = acc.get(log.food_id) || [];
      ids.push(log.id);
      acc.set(log.food_id, ids);
      return acc;
    }, new Map());
  }, [extendedLogs]);

  const loggedMealSections = useMemo(() => mealSections.filter((meal) => meal.logs.length > 0), [mealSections]);
  const mealCountForTargets = Math.max(1, loggedMealSections.length);

  const whoDailyLeucineTarget = latestWeightKg > 0
    ? (latestWeightKg * (WHO_AMINO_TARGETS.find((item) => item.key === 'leucine39')?.mgPerKgDay || 0)) / 1000
    : 0;
  const whoDailyEaaTarget = latestWeightKg > 0
    ? (latestWeightKg * WHO_AMINO_TARGETS.reduce((sum, item) => sum + item.mgPerKgDay, 0)) / 1000
    : 0;

  const perMealLeucineTarget = aminoMode === 'who'
    ? (latestWeightKg > 0 ? whoDailyLeucineTarget / mealCountForTargets : 0)
    : HYPERTROPHY_MEAL_LEUCINE_TARGET;

  const perMealEaaTarget = aminoMode === 'who'
    ? (latestWeightKg > 0 ? whoDailyEaaTarget / mealCountForTargets : 0)
    : HYPERTROPHY_MEAL_EAA_TARGET;

  const perMealAminoTracking = useMemo(
    () =>
      loggedMealSections.map((meal) => {
        const leucineIntake = meal.logs.reduce((sum, log) => sum + getLogLeucineGrams(log), 0);
        const eaaIntake = meal.logs.reduce((sum, log) => sum + getLogTotalEaaGrams(log), 0);

        return {
          id: meal.id,
          label: meal.label,
          leucineIntake,
          eaaIntake,
          leucineHit: perMealLeucineTarget > 0 ? leucineIntake >= perMealLeucineTarget : false,
          eaaHit: perMealEaaTarget > 0 ? eaaIntake >= perMealEaaTarget : false
        };
      }),
    [loggedMealSections, perMealLeucineTarget, perMealEaaTarget]
  );

  const perMealAminoByMealId = useMemo(
    () =>
      perMealAminoTracking.reduce<Record<string, (typeof perMealAminoTracking)[number]>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {}),
    [perMealAminoTracking]
  );

  const proteinGoal = Math.max(goals.protein, 1);
  const proteinProgress = Math.min((analytics.totals.protein / proteinGoal) * 100, 100);

  const leucineSegment = Math.min(Math.max(analytics.eaa.groups.leucine, 0), proteinGoal);
  const eaaMinusLeucineSegment = Math.min(
    Math.max(analytics.eaa.eaaTotal - analytics.eaa.groups.leucine, 0),
    Math.max(proteinGoal - leucineSegment, 0)
  );
  const proteinMinusEaaSegment = Math.min(
    Math.max(analytics.totals.protein - analytics.eaa.eaaTotal, 0),
    Math.max(proteinGoal - leucineSegment - eaaMinusLeucineSegment, 0)
  );
  const proteinRemainingSegment = Math.max(
    proteinGoal - leucineSegment - eaaMinusLeucineSegment - proteinMinusEaaSegment,
    0
  );

  const leucineSegmentPct = (leucineSegment / proteinGoal) * 100;
  const eaaMinusLeucineSegmentPct = (eaaMinusLeucineSegment / proteinGoal) * 100;
  const proteinMinusEaaSegmentPct = (proteinMinusEaaSegment / proteinGoal) * 100;
  const proteinRemainingSegmentPct = (proteinRemainingSegment / proteinGoal) * 100;

  const highlightedMealId = useMemo(() => {
    if (!isToday) return null;

    const now = new Date(timeTick);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let closestMealId: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    mealSections.forEach((meal) => {
      const mealMinutes = parseMealTimeToMinutes(meal.time);
      if (mealMinutes === null) return;

      const distance = circularMinuteDistance(currentMinutes, mealMinutes);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestMealId = meal.id;
      }
    });

    return closestDistance <= 120 ? closestMealId : null;
  }, [isToday, mealSections, timeTick]);

  const moveMealOptions = useMemo<MoveMealOption[]>(() => {
    const options: MoveMealOption[] = [];
    const seen = new Set<string>();

    mealDefinitions.forEach((meal) => {
      const key = normalizeKey(meal.id);
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ id: meal.id, label: meal.name });
    });

    mealSections.forEach((meal) => {
      const key = normalizeKey(meal.id);
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ id: meal.id, label: meal.label });
    });

    return options;
  }, [mealDefinitions, mealSections]);

  const deleteLog = async (id: string) => {
    if (window.confirm('Delete this entry?')) {
      setOpenActionsLogId(null);
      await db.logs.delete(id);
    }
  };

  const moveLogToMeal = async (log: ExtendedLog) => {
    const currentMeal = normalizeKey(log.meal_type || '');
    const candidates = moveMealOptions.filter((option) => normalizeKey(option.id) !== currentMeal);

    if (!candidates.length) {
      alert('No other meal available to move this item.');
      return;
    }

    const optionsText = candidates.map((option, index) => `${index + 1}. ${option.label}`).join('\n');
    const selected = window.prompt(`Move to which meal?\n\n${optionsText}\n\nEnter number:`);

    if (!selected) return;

    const selectedIndex = Number.parseInt(selected, 10) - 1;
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= candidates.length) {
      alert('Invalid selection.');
      return;
    }

    await db.logs.update(log.id, {
      meal_type: candidates[selectedIndex].id,
      synced: 0
    });

    setOpenActionsLogId(null);
  };

  const toggleSupplementCompletion = async (food: Food) => {
    try {
      const existingLogs = await db.logs
        .where('date')
        .equals(date)
        .and((log) => normalizeKey(log.meal_type || '') === 'supplement' && log.food_id === food.id)
        .toArray();

      if (existingLogs.length > 0) {
        await db.logs.bulkDelete(existingLogs.map((log) => log.id));
        return;
      }

      await db.logs.add({
        id: generateId(),
        user_id: currentUserId || 'local-user',
        date,
        meal_type: 'supplement',
        food_id: food.id,
        amount_consumed: 1,
        synced: 0,
        created_at: new Date()
      });
    } catch (error) {
      console.error('Failed to toggle supplement completion:', error);
      alert('Failed to update supplement');
    }
  };

  return (
    <div className="bg-page font-sans">
      <RouteHeader
        title={isReportView ? 'Nutrition Analytics' : 'Daily Log'}
        onBack={isReportView ? () => setPanelWithTransition(null, 'backward') : undefined}
        rightAction={isReportView ? null : (
          <div className="flex items-center gap-2">
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
                  onChange={(e) => {
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.set('date', e.target.value);
                    setSearchParams(nextParams);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <span className="text-sm font-bold text-text-main leading-none flex items-center gap-1.5">
                  <Calendar size={12} className="text-brand" />
                  {isToday ? 'Today' : displayDate}
                </span>
                {!isToday && <span className="text-[10px] text-text-muted leading-none mt-0.5">{displayDate}</span>}
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
        )}
      />

      <main className="max-w-md mx-auto p-4 space-y-5">
        <div className="bg-card rounded-2xl shadow-sm p-4 border border-border-subtle mb-4">
          <div className="flex items-start justify-between gap-2 pl-1">
            <div className="flex items-center gap-2">
              <div
                className="relative w-24 h-24 rounded-full shrink-0"
                style={{
                  background: `conic-gradient(var(--color-brand) ${caloriePercent}%, var(--color-surface) ${caloriePercent}% 100%)`
                }}
              >
                <div className="w-16 h-16 rounded-full bg-card border border-border-subtle absolute inset-0 m-auto flex items-center justify-center">
                  <span className="text-[11px] font-bold text-text-main">{Math.round(caloriePercentRaw)}%</span>
                </div>
              </div>

              <div>
                <p className="text-3xl font-extrabold text-text-main leading-none">{Math.round(dailyTotals.calories)}</p>
                <p className="text-sm text-text-muted mt-0.5">/ {goals.calories}</p>
                <p className={`mt-1 inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${remainingCalories >= 0 ? 'text-brand bg-surface' : 'text-macro-fat bg-surface'}`}>
                  {remainingCalories >= 0 ? `${remainingCalories} kcal left` : `${Math.abs(remainingCalories)} kcal over`}
                </p>
              </div>
            </div>

            {!isReportView && (
              <button
                type="button"
                onClick={() => setPanelWithTransition('report', 'forward')}
                className="p-1.5 rounded-full border border-border-subtle bg-surface text-text-muted hover:text-text-main hover:border-brand transition-colors self-start"
                title="Nutrition Analytics"
              >
                <AnalyticsIcon size={16} />
              </button>
            )}
          </div>

          {showAnalytics && (
            <div className="mt-3 space-y-3">
              <div className="bg-card rounded-xl p-3 border border-border-subtle space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-text-main">Protein</p>
                  <p className="text-xs text-text-muted font-medium">
                    {Math.round(analytics.totals.protein * 10) / 10}g/{Math.round(goals.protein * 10) / 10}g
                  </p>
                </div>

                <div className="h-2 rounded-full border border-border-subtle overflow-hidden flex">
                  <div
                    className="bg-macro-protein h-full"
                    style={{ width: `${leucineSegmentPct}%` }}
                    title={`Leucine ${Math.round(leucineSegment * 100) / 100}g`}
                  />
                  <div
                    className="bg-macro-protein/70 h-full"
                    style={{ width: `${eaaMinusLeucineSegmentPct}%` }}
                    title={`EAA - Leucine ${Math.round(eaaMinusLeucineSegment * 100) / 100}g`}
                  />
                  <div
                    className="bg-macro-protein/35 h-full"
                    style={{ width: `${proteinMinusEaaSegmentPct}%` }}
                    title={`Protein - EAA ${Math.round(proteinMinusEaaSegment * 100) / 100}g`}
                  />
                  <div
                    className="bg-surface h-full"
                    style={{ width: `${proteinRemainingSegmentPct}%` }}
                    title={`Remaining ${Math.round(proteinRemainingSegment * 100) / 100}g`}
                  />
                </div>

                <div className="flex items-center gap-2 text-[11px]">
                  <p className="text-text-muted">Leucine: {Math.round(analytics.eaa.groups.leucine * 100) / 100}g</p>
                  <span className="text-text-muted">•</span>
                  <p className="text-text-muted">EAA: {Math.round(analytics.eaa.eaaTotal * 100) / 100}g</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  {
                    key: 'carbs',
                    label: 'Carbs',
                    total: analytics.totals.carbs,
                    goal: goals.carbs,
                    remaining: analytics.remaining.carbs,
                    barClass: 'bg-macro-carbs'
                  },
                  {
                    key: 'fat',
                    label: 'Fat',
                    total: analytics.totals.fat,
                    goal: goals.fat,
                    remaining: analytics.remaining.fat,
                    barClass: 'bg-macro-fat'
                  },
                  {
                    key: 'fiber',
                    label: 'Fiber',
                    total: analytics.totals.fiber,
                    goal: fiberGoal,
                    remaining: analytics.remaining.fiber,
                    barClass: 'bg-brand'
                  }
                ].map((item) => {
                  const progress = Math.min((item.total / Math.max(item.goal, 1)) * 100, 100);

                  return (
                    <div key={item.key} className="bg-surface rounded-xl p-2.5 border border-border-subtle">
                      <div className="flex items-baseline justify-between gap-1">
                        <p className="text-text-muted font-medium text-[11px]">{item.label}</p>
                        <p className="text-[10px] text-text-muted">{Math.round(progress)}%</p>
                      </div>
                      <p className="font-bold text-text-main mt-0.5 text-[13px]">
                        {Math.round(item.total)}g <span className="text-text-muted font-medium text-[10px]">/ {Math.round(item.goal)}g</span>
                      </p>
                      <div className="mt-1.5 h-1.5 rounded-full bg-card border border-border-subtle overflow-hidden">
                        <div className={`${item.barClass} h-full rounded-full`} style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-text-muted mt-1 text-[10px]">Need {Math.round(item.remaining)}g</p>
                    </div>
                  );
                })}
              </div>

              <div className="bg-surface rounded-xl p-3 border border-border-subtle space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text-main">Macro contributors</p>
                  <p className="text-[11px] text-text-muted">By grams toward selected goal</p>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {macroTabConfig.map((tab) => {
                    const isActive = activeMacroTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveMacroTab(tab.key)}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                          isActive
                            ? 'bg-card border-brand text-brand'
                            : 'bg-card border-border-subtle text-text-muted hover:text-text-main hover:border-brand'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {selectedMacroContributors.length === 0 ? (
                  <p className="text-xs text-text-muted">No food entries contributed to {activeMacroTab} for this day.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedMacroContributors.map((item) => {
                      const loggedAmountRounded = Math.round(item.loggedAmount * 10) / 10;
                      const loggedUnitNormalized = normalizeServingUnitLabel(item.loggedUnit);
                      const loggedCaloriesRounded = Math.round(item.loggedCalories);

                      return (
                        <div key={item.id} className="bg-card rounded-lg border border-border-subtle px-2.5 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium text-text-main truncate">{item.name}</p>
                            <p className="text-xs font-semibold text-text-main whitespace-nowrap">
                              {Math.round(item.grams * 10) / 10}g
                            </p>
                          </div>
                          <p className="text-[11px] text-text-muted mt-0.5">
                            {loggedAmountRounded} {loggedUnitNormalized} {loggedCaloriesRounded} calories
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="bg-card border border-border-subtle rounded-xl px-2.5 py-2">
                  <p className="text-xs font-semibold text-text-main">Essential Vitamins</p>
                  <p className="text-[11px] text-text-muted">Vitamins are critical for immune resilience and converting food into cellular fuel.</p>
                  <p className="text-[11px] text-text-muted mt-0.5">RDA for Men (Age 30)</p>
                  <div className="mt-2 space-y-2">
                    {micronutrientTracking.vitamins.map((item) => (
                      <div key={item.key} className="bg-surface border border-border-subtle rounded-lg px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-text-main">{item.label}</p>
                          <p className="text-[11px] text-text-muted">{formatNutrientAmount(item.consumed, item.unit)} / {item.targetLabel}</p>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-card border border-border-subtle overflow-hidden">
                          <div className="bg-brand h-full rounded-full" style={{ width: `${item.progress}%` }} />
                        </div>
                        <p className="text-[11px] text-text-muted mt-1">{item.functionText}</p>
                        <p className="text-[11px] text-text-muted">{item.status}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-card border border-border-subtle rounded-xl px-2.5 py-2">
                  <p className="text-xs font-semibold text-text-main">Essential Minerals</p>
                  <p className="text-[11px] text-text-muted">Minerals are categorized into macrominerals and trace minerals.</p>
                  <p className="text-[11px] text-text-muted mt-0.5">RDA for Men (Age 30)</p>
                  <div className="mt-2 space-y-2">
                    {micronutrientTracking.minerals.map((item) => (
                      <div key={item.key} className="bg-surface border border-border-subtle rounded-lg px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-text-main">{item.label}</p>
                          <p className="text-[11px] text-text-muted">{formatNutrientAmount(item.consumed, item.unit)} / {item.targetLabel}</p>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-card border border-border-subtle overflow-hidden">
                          <div className="bg-brand h-full rounded-full" style={{ width: `${item.progress}%` }} />
                        </div>
                        <p className="text-[11px] text-text-muted mt-1">{item.functionText}</p>
                        <p className="text-[11px] text-text-muted">{item.status}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {!isReportView && mealSections.map((meal) => {
          const mealCalories = meal.logs.reduce((sum, log) => sum + log.calories, 0);
          const mealAmino = perMealAminoByMealId[meal.id];
          const isSupplementSection = normalizeKey(meal.id) === 'supplement';
          const usesSupplementChecklist = isSupplementSection && (supplementFoods?.length || 0) > 0;

          return (
            <div key={meal.id} className="mb-6">
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold text-text-main">{meal.label}</h3>
                  {meal.time && (
                    <span className="text-[11px] font-medium text-text-muted bg-surface border border-border-subtle px-2 py-0.5 rounded-full">
                      {meal.time}
                    </span>
                  )}
                  {meal.targetKcal !== undefined && (
                    <span className="text-[11px] font-bold text-brand bg-surface border border-border-subtle px-2 py-0.5 rounded-full">
                      {meal.targetKcal} kcal target
                    </span>
                  )}
                </div>
                <span className="text-sm text-text-muted font-medium">{mealCalories} kcal</span>
              </div>

              {!isSupplementSection && (
                <div className="mb-3 bg-surface rounded-xl p-2.5 border border-border-subtle">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[11px] font-semibold text-text-main">Amino target</p>
                    <span className="text-[11px] font-semibold text-brand">
                      {aminoMode === 'hypertrophy' ? 'Hypertrophy' : 'WHO'}
                    </span>
                  </div>

                  {mealAmino ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <p className="text-text-muted">
                          Leucine {Math.round(mealAmino.leucineIntake * 100) / 100}g / {Math.round(perMealLeucineTarget * 100) / 100}g
                        </p>
                        <span className={`font-semibold ${mealAmino.leucineHit ? 'text-brand' : 'text-text-muted'}`}>
                          {perMealLeucineTarget > 0 ? (mealAmino.leucineHit ? 'Met' : 'Miss') : 'No target'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <p className="text-text-muted">
                          EAA {Math.round(mealAmino.eaaIntake * 100) / 100}g / {Math.round(perMealEaaTarget * 100) / 100}g
                        </p>
                        <span className={`font-semibold ${mealAmino.eaaHit ? 'text-brand' : 'text-text-muted'}`}>
                          {perMealEaaTarget > 0 ? (mealAmino.eaaHit ? 'Met' : 'Miss') : 'No target'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-muted">No food logged in this meal yet.</p>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {usesSupplementChecklist && (
                  <div className="bg-surface rounded-xl border border-border-subtle p-2.5">
                    <p className="text-[11px] font-semibold text-text-main mb-2">Supplements checklist</p>
                    <div className="space-y-2">
                      {supplementFoods!.map((food) => {
                        const completed = supplementLogIdsByFood.has(food.id);

                        return (
                          <button
                            key={`supplement-check-${food.id}`}
                            type="button"
                            onClick={() => toggleSupplementCompletion(food)}
                            className={`w-full px-3 py-2 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors ${
                              completed
                                ? 'bg-brand/10 border-brand text-text-main'
                                : 'bg-card border-border-subtle text-text-main hover:border-brand'
                            }`}
                            aria-label={`${completed ? 'Mark not completed' : 'Mark completed'} ${food.name}`}
                          >
                            <span className="text-sm font-medium truncate">{food.name}</span>
                            <span className={`text-sm font-bold ${completed ? 'text-brand' : 'text-text-muted'}`}>
                              {completed ? '✓' : '○'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!usesSupplementChecklist && meal.logs.map((log) => {
                  const proteinKcal = Math.max(0, log.protein * 4);
                  const carbsKcal = Math.max(0, log.carbs * 4);
                  const fatKcal = Math.max(0, log.fat * 9);
                  const macroKcalTotal = Math.max(1, proteinKcal + carbsKcal + fatKcal);
                  const proteinPct = (proteinKcal / macroKcalTotal) * 100;
                  const carbsPct = (carbsKcal / macroKcalTotal) * 100;
                  const fatPct = (fatKcal / macroKcalTotal) * 100;

                  return (
                    <div
                      key={log.id}
                      className="bg-card p-4 rounded-xl shadow-sm border border-border-subtle flex justify-between items-start relative"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="font-medium text-text-main truncate">
                          {log.food?.name || 'Unknown Food'}
                          <span className="text-xs text-text-muted font-normal ml-1">
                            ({log.food?.serving_unit && WEIGHT_BASED_REGEX.test(log.food.serving_unit)
                              ? `${Math.round(log.amount_consumed * (log.food.serving_size || 100))}${log.food.serving_unit}`
                              : `${log.amount_consumed} ${log.food?.serving_unit || 'svg'}`})
                          </span>
                        </div>
                        <div className="text-xs text-text-muted mt-1 flex items-center gap-2">
                          <span className="whitespace-nowrap">{log.calories} kcal</span>
                          <div className="w-28 shrink-0 h-2 rounded-full overflow-hidden bg-surface border border-border-subtle flex">
                            <div className="bg-macro-protein" style={{ width: `${proteinPct}%` }} title={`${log.protein}p`} />
                            <div className="bg-macro-carbs" style={{ width: `${carbsPct}%` }} title={`${log.carbs}c`} />
                            <div className="bg-macro-fat" style={{ width: `${fatPct}%` }} title={`${log.fat}f`} />
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 relative">
                        <button
                          type="button"
                          onClick={() => setOpenActionsLogId((current) => (current === log.id ? null : log.id))}
                          className="w-8 h-8 rounded-full border border-border-subtle bg-surface text-text-muted hover:text-text-main hover:border-brand transition-colors flex items-center justify-center"
                          aria-label="Open food log actions"
                        >
                          ⋯
                        </button>

                        {openActionsLogId === log.id && (
                          <div className="absolute right-0 top-9 z-20 min-w-28 bg-card border border-border-subtle rounded-lg shadow-sm py-1">
                            <Link
                              to={`/log/add?date=${date}&meal=${encodeURIComponent(log.meal_type || meal.id)}&log_id=${log.id}`}
                              onClick={() => setOpenActionsLogId(null)}
                              className="block px-3 py-1.5 text-[11px] font-semibold text-brand hover:bg-surface"
                            >
                              Edit qty
                            </Link>
                            <button
                              type="button"
                              onClick={() => moveLogToMeal(log)}
                              className="w-full text-left px-3 py-1.5 text-[11px] font-semibold text-text-main hover:bg-surface"
                            >
                              Move
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteLog(log.id)}
                              className="w-full text-left px-3 py-1.5 text-[11px] font-semibold text-red-500 hover:bg-surface"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                <Link
                  to={`/log/add?date=${date}&meal=${encodeURIComponent(meal.id)}`}
                  className={`block w-full text-center py-3 border-2 rounded-xl hover:border-brand hover:text-brand hover:bg-surface transition-all text-sm font-medium ${
                    highlightedMealId === meal.id
                      ? 'border-brand bg-surface text-brand add-food-time-highlight'
                      : 'border-dashed border-border-subtle text-text-muted'
                  }`}
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