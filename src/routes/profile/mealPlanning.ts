export type MealTargetMode = 'percent' | 'calories';

export interface MealSetting {
  id: string;
  name: string;
  time: string;
  targetMode: MealTargetMode;
  targetValue: number;
}

interface MealPreset {
  id?: string;
  name: string;
  time: string;
  targetValue: number;
}

interface MealPatternCountHint {
  min: number;
  max: number;
  label: string;
}

export interface FastingWindowHint {
  eatingStart: string;
  eatingEnd: string;
  eatingHours: number;
  fastingHours: number;
  exceedsGoal: boolean;
}

export interface MealTimingAdvice {
  score: number;
  advice: string;
  summary: string;
}

const TIME_PATTERN = /^\d{2}:\d{2}$/;
export const IF_16_8_EATING_WINDOW_GOAL_HOURS = 8;

const MEAL_PATTERN_PRESETS: Record<string, MealPreset[]> = {
  three_meals: [
    { id: 'breakfast', name: 'Breakfast', time: '08:00', targetValue: 30 },
    { id: 'lunch', name: 'Lunch', time: '13:00', targetValue: 35 },
    { id: 'dinner', name: 'Dinner', time: '19:00', targetValue: 35 }
  ],
  three_plus_snacks: [
    { id: 'breakfast', name: 'Breakfast', time: '08:00', targetValue: 25 },
    { id: 'lunch', name: 'Lunch', time: '13:00', targetValue: 35 },
    { id: 'snack', name: 'Snack', time: '16:00', targetValue: 10 },
    { id: 'dinner', name: 'Dinner', time: '19:00', targetValue: 30 }
  ],
  if_16_8: [
    { id: 'lunch', name: 'Lunch', time: '12:00', targetValue: 40 },
    { id: 'snack', name: 'Snack', time: '16:00', targetValue: 15 },
    { id: 'dinner', name: 'Dinner', time: '20:00', targetValue: 45 }
  ],
  small_frequent: [
    { name: 'Meal 1', time: '07:00', targetValue: 15 },
    { name: 'Meal 2', time: '10:00', targetValue: 20 },
    { name: 'Meal 3', time: '13:00', targetValue: 20 },
    { name: 'Meal 4', time: '16:00', targetValue: 15 },
    { name: 'Meal 5', time: '19:00', targetValue: 15 },
    { name: 'Meal 6', time: '21:00', targetValue: 15 }
  ]
};

const MEAL_PATTERN_COUNT_HINTS: Record<string, MealPatternCountHint> = {
  three_meals: { min: 3, max: 3, label: '3 Meals' },
  three_plus_snacks: { min: 4, max: 5, label: '3 Meals + Snacks' },
  if_16_8: { min: 2, max: 4, label: '16:8' },
  small_frequent: { min: 5, max: 7, label: 'Small Frequent Meals' }
};

export const toMinutes = (time: string): number => {
  const [hours, minutes] = String(time || '').split(':').map((item) => Number(item));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
};

export const toTimeString = (minutes: number): string => {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
};

export const formatDurationHours = (value: number) => `${Math.round(value * 10) / 10}h`;

export const buildMealsFromPattern = (pattern: string, createId: () => string): MealSetting[] => {
  const preset = MEAL_PATTERN_PRESETS[pattern];
  if (!preset?.length) return [];

  return preset.map((meal) => ({
    id: meal.id || createId(),
    name: meal.name,
    time: meal.time,
    targetMode: 'percent',
    targetValue: meal.targetValue
  }));
};

export const getSuggestedMealTime = (meals: MealSetting[]): string => {
  const timedMeals = meals
    .filter((meal) => TIME_PATTERN.test(meal.time))
    .map((meal) => toMinutes(meal.time))
    .sort((a, b) => a - b);

  if (timedMeals.length === 0) return '12:00';
  if (timedMeals.length === 1) return toTimeString(timedMeals[0] + 4 * 60);

  let largestGap = -1;
  let insertAt = timedMeals[0];

  for (let index = 1; index < timedMeals.length; index += 1) {
    const gap = timedMeals[index] - timedMeals[index - 1];
    if (gap > largestGap) {
      largestGap = gap;
      insertAt = timedMeals[index - 1] + gap / 2;
    }
  }

  return toTimeString(insertAt);
};

export const getFastingWindowHint = (mealPattern: string, meals: MealSetting[]): FastingWindowHint | null => {
  if (mealPattern !== 'if_16_8' || meals.length === 0) return null;

  const sortedMealTimes = meals
    .map((meal) => meal.time)
    .filter((time) => TIME_PATTERN.test(time))
    .sort();

  if (sortedMealTimes.length === 0) return null;

  const eatingStart = sortedMealTimes[0];
  const eatingEnd = sortedMealTimes[sortedMealTimes.length - 1];
  const eatingHours = Math.max(0, (toMinutes(eatingEnd) - toMinutes(eatingStart)) / 60);
  const fastingHours = Math.max(0, 24 - eatingHours);
  const exceedsGoal = eatingHours > IF_16_8_EATING_WINDOW_GOAL_HOURS;

  return {
    eatingStart,
    eatingEnd,
    eatingHours,
    fastingHours,
    exceedsGoal
  };
};

export const getMealTimingAdvice = (
  meals: MealSetting[],
  mealPattern: string,
  fastingWindowHint: FastingWindowHint | null
): MealTimingAdvice => {
  const mealCount = meals.length;
  const patternCountHint = MEAL_PATTERN_COUNT_HINTS[mealPattern];

  const targetCount = patternCountHint
    ? Math.round((patternCountHint.min + patternCountHint.max) / 2)
    : 4;

  const countPenalty = patternCountHint
    ? mealCount < patternCountHint.min
      ? (patternCountHint.min - mealCount) * 16
      : mealCount > patternCountHint.max
        ? (mealCount - patternCountHint.max) * 12
        : Math.abs(mealCount - targetCount) * 3
    : Math.abs(mealCount - targetCount) * 6;

  const timedMeals = meals
    .filter((meal) => TIME_PATTERN.test(meal.time))
    .map((meal) => ({ ...meal, minutes: toMinutes(meal.time) }))
    .sort((a, b) => a.minutes - b.minutes);

  if (timedMeals.length < 2) {
    const score = Math.max(0, 100 - countPenalty - 15);
    const advice = 'Add meal times for at least 2 meals to get reliable timing guidance.';
    return { score, advice, summary: `${mealCount} meals configured` };
  }

  const lastMeal = timedMeals[timedMeals.length - 1];
  const mealGaps = timedMeals.slice(1).map((meal, index) => meal.minutes - timedMeals[index].minutes);
  const tightGapCount = mealGaps.filter((gap) => gap < 2 * 60).length;
  const farGapCount = mealGaps.filter((gap) => gap > 5 * 60).length;
  const largestGapHours = Math.max(...mealGaps) / 60;

  const spacingPenalty = tightGapCount * 14 + farGapCount * 18;
  const imbalancePenalty = tightGapCount > 0 && farGapCount > 0 ? 16 : 0;
  const lateMealPenalty = lastMeal.minutes >= 21 * 60 ? 8 : 0;
  const fastingPenalty = mealPattern === 'if_16_8' && fastingWindowHint?.exceedsGoal
    ? Math.max(0, Math.round((fastingWindowHint.eatingHours - IF_16_8_EATING_WINDOW_GOAL_HOURS) * 8))
    : 0;

  const totalPenalty = Math.min(95, countPenalty + spacingPenalty + imbalancePenalty + lateMealPenalty + fastingPenalty);
  const score = Math.max(5, 100 - totalPenalty);

  const issuePenalties: Array<{ key: 'count' | 'uneven' | 'far' | 'tight' | 'fasting' | 'late'; value: number }> = [
    { key: 'count', value: countPenalty },
    { key: 'uneven', value: imbalancePenalty + (tightGapCount > 0 && farGapCount > 0 ? Math.round(spacingPenalty * 0.35) : 0) },
    { key: 'far', value: farGapCount > 0 ? farGapCount * 18 : 0 },
    { key: 'tight', value: tightGapCount > 0 ? tightGapCount * 14 : 0 },
    { key: 'fasting', value: fastingPenalty },
    { key: 'late', value: lateMealPenalty }
  ];

  const topIssue = issuePenalties.sort((a, b) => b.value - a.value)[0];

  let advice = 'Meal timing and count look balanced. Keep this schedule consistent.';

  if (topIssue.value > 0) {
    if (topIssue.key === 'count') {
      if (mealCount >= 10) {
        advice = 'Meal count is high (10+). Consolidate into fewer meals and keep 2.5-4h gaps for easier adherence.';
      } else if (patternCountHint && mealCount > patternCountHint.max) {
        advice = `Meal count is above ${patternCountHint.label}. Try ${patternCountHint.min}-${patternCountHint.max} meals.`;
      } else if (patternCountHint && mealCount < patternCountHint.min) {
        advice = `Meal count is below ${patternCountHint.label}. Add meals to reach at least ${patternCountHint.min}.`;
      } else {
        advice = 'Meal count can be improved for consistency. Adjust toward your usual daily pattern.';
      }
    } else if (topIssue.key === 'uneven') {
      advice = 'Meals are unevenly distributed (some too close, some too far). Re-spread meals to mostly 2.5-4h gaps.';
    } else if (topIssue.key === 'far') {
      advice = 'One or more meal gaps are too long. Move a meal earlier/later or add a small bridge snack.';
    } else if (topIssue.key === 'tight') {
      advice = 'Some meals are too tightly packed. Space them out by at least ~2.5 hours.';
    } else if (topIssue.key === 'fasting') {
      advice = 'Your 16:8 eating window is too wide. Start later or end earlier to stay near 8h eating time.';
    } else if (topIssue.key === 'late') {
      advice = 'Last meal is late; shifting it earlier can support better sleep and recovery.';
    }
  }

  const summary = `${mealCount} meals • largest gap ${formatDurationHours(largestGapHours)}`;
  return { score, advice, summary };
};

export const sortMealsForDisplay = (meals: MealSetting[]): MealSetting[] => {
  return [...meals].sort((a, b) => {
    const aValid = TIME_PATTERN.test(a.time);
    const bValid = TIME_PATTERN.test(b.time);

    if (aValid && bValid) return toMinutes(a.time) - toMinutes(b.time);
    if (aValid) return -1;
    if (bValid) return 1;

    return a.name.localeCompare(b.name);
  });
};