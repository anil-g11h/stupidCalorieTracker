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
import { db, type DailyLog, type Food } from '../lib/db';
import { analyzeEaaRatio } from '../lib/eaa';
import RouteHeader from '../lib/components/RouteHeader';

const SETTINGS_KEY = 'stupid_tracker_settings_v1';
const SETTINGS_ID = 'local-settings';
const DEFAULT_MEAL_IDS = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement'] as const;
const WEIGHT_BASED_REGEX = /^(g|ml|oz)$/i;

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

    const meals = Array.isArray(parsed.meals)
      ? parsed.meals
          .map((meal) => {
            const id = typeof meal?.id === 'string' ? meal.id.trim() : '';
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
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showMicronutrients, setShowMicronutrients] = useState(false);
  const [timeTick, setTimeTick] = useState(() => Date.now());
  const [openActionsLogId, setOpenActionsLogId] = useState<string | null>(null);

  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
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
    setSearchParams({ date: next.toISOString().split('T')[0] });
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
    const fiberKeyRegex = /^fibre$|^fiber$|^dietary[_\s-]*fiber$/i;

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

        if (fiberKeyRegex.test(key.trim())) {
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
    if (settings?.meals?.length) {
      return settings.meals.map(buildMealDefinitionFromSetting);
    }
    return getDefaultMeals();
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

  return (
    <div className="min-h-screen bg-page pb-20 font-sans">
      <RouteHeader
        title="Daily Log"
        rightAction={
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
                  onChange={(e) => setSearchParams({ date: e.target.value })}
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
        }
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

            <button
              type="button"
              onClick={() => setShowAnalytics((prev) => !prev)}
              className="p-1.5 rounded-full border border-border-subtle bg-surface text-text-muted hover:text-text-main hover:border-brand transition-colors self-start"
              title="Nutrition Analytics"
            >
              <AnalyticsIcon size={16} />
            </button>
          </div>

          {showAnalytics && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  {
                    key: 'protein',
                    label: 'Protein',
                    total: analytics.totals.protein,
                    goal: goals.protein,
                    remaining: analytics.remaining.protein,
                    barClass: 'bg-macro-protein'
                  },
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
                    <div key={item.key} className="bg-surface rounded-xl p-3 border border-border-subtle">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-text-muted font-medium">{item.label}</p>
                        <p className="text-[11px] text-text-muted">{Math.round(progress)}%</p>
                      </div>
                      <p className="font-bold text-text-main mt-1">
                        {Math.round(item.total)}g <span className="text-text-muted font-medium">/ {Math.round(item.goal)}g</span>
                      </p>
                      <div className="mt-2 h-1.5 rounded-full bg-card border border-border-subtle overflow-hidden">
                        <div className={`${item.barClass} h-full rounded-full`} style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-text-muted mt-2">Need {Math.round(item.remaining)}g</p>
                    </div>
                  );
                })}
              </div>

              <div className="bg-surface rounded-xl p-3 border border-border-subtle space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text-main">EAA Quality (4:2:2:2)</p>
                  <span className="text-[11px] text-text-muted font-medium">Leu : Lys : Val+Iso : Rest</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-card rounded-lg border border-border-subtle px-2.5 py-2">
                    <p className="text-text-muted">Protein eaten</p>
                    <p className="font-bold text-text-main mt-0.5">{Math.round(analytics.eaa.proteinTotal)}g</p>
                  </div>
                  <div className="bg-card rounded-lg border border-border-subtle px-2.5 py-2">
                    <p className="text-text-muted">EAA tracked</p>
                    <p className="font-bold text-text-main mt-0.5">{Math.round(analytics.eaa.eaaTotal * 10) / 10}g</p>
                  </div>
                  <div className="bg-card rounded-lg border border-border-subtle px-2.5 py-2">
                    <p className="text-text-muted">EAA / Protein</p>
                    <p className="font-bold text-text-main mt-0.5">{Math.round(analytics.eaa.eaaAsProteinPercent)}%</p>
                  </div>
                </div>

                <div className="text-[11px] text-text-muted">
                  Coverage: {Math.round(analytics.eaaCoveragePercent)}% protein has amino profile ({Math.round(analytics.eaa.proteinWithEaaData)}g known / {Math.round(analytics.eaa.proteinMissingEaaData)}g unknown)
                </div>

                <div className="space-y-2">
                  {[
                    { key: 'leucine', label: 'Leucine (4)', barClass: 'bg-brand' },
                    { key: 'lysine', label: 'Lysine (2)', barClass: 'bg-macro-protein' },
                    { key: 'valineIsoleucine', label: 'Valine + Isoleucine (2)', barClass: 'bg-macro-carbs' },
                    { key: 'rest', label: 'Rest EAAs (2)', barClass: 'bg-macro-fat' }
                  ].map((item) => {
                    const actual = analytics.eaa.groups[item.key as 'leucine' | 'lysine' | 'valineIsoleucine' | 'rest'];
                    const target = analytics.eaa.targetByCurrentTotal[item.key as 'leucine' | 'lysine' | 'valineIsoleucine' | 'rest'];
                    const deficit = analytics.eaa.deficitByGroup[item.key as 'leucine' | 'lysine' | 'valineIsoleucine' | 'rest'];
                    const progress = Math.min((actual / Math.max(target, 0.0001)) * 100, 100);

                    return (
                      <div key={item.key} className="bg-card rounded-lg border border-border-subtle px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-text-main font-medium">{item.label}</p>
                          <p className="text-[11px] text-text-muted">{Math.round(progress)}%</p>
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                          {Math.round(actual * 100) / 100}g / target {Math.round(target * 100) / 100}g
                        </p>
                        <div className="mt-1.5 h-1.5 rounded-full bg-surface border border-border-subtle overflow-hidden">
                          <div className={`${item.barClass} h-full rounded-full`} style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-[11px] text-text-muted mt-1">
                          {deficit > 0 ? `Need ${Math.round(deficit * 100) / 100}g` : 'On ratio'}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  const deficits = [
                    { key: 'Leucine', value: analytics.eaa.deficitByGroup.leucine },
                    { key: 'Lysine', value: analytics.eaa.deficitByGroup.lysine },
                    { key: 'Valine + Isoleucine', value: analytics.eaa.deficitByGroup.valineIsoleucine },
                    { key: 'Rest EAAs', value: analytics.eaa.deficitByGroup.rest }
                  ].sort((a, b) => b.value - a.value);

                  if (deficits[0].value <= 0) {
                    return <p className="text-[11px] font-medium text-brand">Great balance: your EAA groups align with 4:2:2:2.</p>;
                  }

                  return (
                    <p className="text-[11px] text-text-muted">
                      Most lacking: <span className="font-semibold text-text-main">{deficits[0].key}</span> (need {Math.round(deficits[0].value * 100) / 100}g)
                    </p>
                  );
                })()}
              </div>

              <div className="bg-surface rounded-xl p-3 border border-border-subtle">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold text-text-main">Micronutrients tracked</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-muted font-medium">{micronutrientTracking.trackedCount}/14 tracked</span>
                    <button
                      type="button"
                      onClick={() => setShowMicronutrients((prev) => !prev)}
                      className="text-[11px] font-semibold text-brand hover:text-text-main transition-colors"
                    >
                      {showMicronutrients ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                {!showMicronutrients ? null : (
                  <div className="space-y-3">
                    <div className="bg-card border border-border-subtle rounded-lg px-2.5 py-2">
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

                    <div className="bg-card border border-border-subtle rounded-lg px-2.5 py-2">
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
                )}
              </div>
            </div>
          )}
        </div>

        {mealSections.map((meal) => {
          const mealCalories = meal.logs.reduce((sum, log) => sum + log.calories, 0);

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

              <div className="space-y-3">
                {meal.logs.map((log) => {
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