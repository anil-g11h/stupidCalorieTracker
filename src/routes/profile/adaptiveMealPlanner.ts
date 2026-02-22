import { getDietaryConflictWarnings, type DietaryPreferences } from '../../lib/dietaryProfile';
import { type Food } from '../../lib/db';
import { type MealSetting } from './mealPlanning';

export interface PlannedMealFood {
  foodId: string;
  foodName: string;
  quantity: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  warnings: string[];
}

export interface PlannedMeal {
  mealId: string;
  mealName: string;
  mealTime: string;
  target: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  items: PlannedMealFood[];
  passesDietaryFilters: boolean;
}

export interface AdaptiveMealPlan {
  createdAt: string;
  meals: PlannedMeal[];
  dietaryPassRate: number;
  summary: {
    targetCalories: number;
    plannedCalories: number;
    targetProtein: number;
    plannedProtein: number;
    targetCarbs: number;
    plannedCarbs: number;
    targetFat: number;
    plannedFat: number;
    caloriesWithin10Percent: boolean;
    proteinWithin10Percent: boolean;
    carbsWithin10Percent: boolean;
    fatWithin10Percent: boolean;
  };
}

interface GenerateAdaptiveMealPlanInput {
  meals: MealSetting[];
  foods: Food[];
  dietaryPreferences: DietaryPreferences;
  ingredientNamesByFoodId?: Record<string, string[]>;
  dailyTargets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

interface ScoredFood {
  food: Food;
  quantity: number;
  score: number;
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  warnings: string[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

const calculateAbsolutePercentError = (actual: number, target: number) => {
  if (target <= 0) return actual <= 0 ? 0 : 1;
  return Math.abs(actual - target) / target;
};

const mealScore = (
  totals: { calories: number; protein: number; carbs: number; fat: number },
  target: { calories: number; protein: number; carbs: number; fat: number },
  quantityPenalty = 0
) => {
  const calorieError = calculateAbsolutePercentError(totals.calories, target.calories);
  const proteinError = calculateAbsolutePercentError(totals.protein, target.protein);
  const carbsError = calculateAbsolutePercentError(totals.carbs, target.carbs);
  const fatError = calculateAbsolutePercentError(totals.fat, target.fat);

  return calorieError * 1.5 + proteinError * 1.3 + carbsError + fatError + quantityPenalty;
};

const buildScoredFood = (
  food: Food,
  target: { calories: number; protein: number; carbs: number; fat: number },
  warnings: string[]
): ScoredFood | null => {
  if (!Number.isFinite(food.calories) || food.calories <= 0) return null;

  const idealQuantity = target.calories > 0 ? target.calories / food.calories : 1;
  const quantity = clamp(idealQuantity, 0.25, 3.5);
  const totals = {
    calories: round2(food.calories * quantity),
    protein: round2(food.protein * quantity),
    carbs: round2(food.carbs * quantity),
    fat: round2(food.fat * quantity)
  };

  const quantityPenalty = quantity > 2.75 ? (quantity - 2.75) * 0.15 : 0;
  const score = mealScore(totals, target, quantityPenalty);

  return { food, quantity: round2(quantity), score, totals, warnings };
};

const buildMacroPercentCheck = (target: number, actual: number) => {
  if (target <= 0) return actual <= 0;
  return Math.abs(actual - target) / target <= 0.1;
};

export const generateAdaptiveMealPlan = ({
  meals,
  foods,
  dietaryPreferences,
  ingredientNamesByFoodId = {},
  dailyTargets
}: GenerateAdaptiveMealPlanInput): AdaptiveMealPlan | null => {
  if (!meals.length || !foods.length) return null;

  const totalMealWeight = meals.reduce((sum, meal) => sum + Math.max(0, Number(meal.targetValue) || 0), 0);
  const normalizedMealWeight = totalMealWeight > 0 ? totalMealWeight : meals.length;

  const warningMap = foods.reduce<Record<string, string[]>>((acc, food) => {
    acc[food.id] = getDietaryConflictWarnings(
      dietaryPreferences,
      food,
      ingredientNamesByFoodId[food.id] || []
    );
    return acc;
  }, {});

  const safeFoods = foods.filter((food) => (warningMap[food.id] || []).length === 0);
  const candidateFoods = safeFoods.length > 0 ? safeFoods : foods;

  const plannedMeals = meals.reduce<PlannedMeal[]>((acc, meal) => {
    const mealWeight = totalMealWeight > 0 ? Math.max(0, meal.targetValue || 0) : 1;
    const share = normalizedMealWeight > 0 ? mealWeight / normalizedMealWeight : 1 / meals.length;
    const target = {
      calories: round2(dailyTargets.calories * share),
      protein: round2(dailyTargets.protein * share),
      carbs: round2(dailyTargets.carbs * share),
      fat: round2(dailyTargets.fat * share)
    };

    const scoredCandidates = candidateFoods
      .map((food) => buildScoredFood(food, target, warningMap[food.id] || []))
      .filter((item): item is ScoredFood => Boolean(item))
      .sort((a, b) => a.score - b.score)
      .slice(0, 16);

    const bestSingle = scoredCandidates[0];
    if (!bestSingle) return acc;

    let chosenFoods: Array<{
      food: Food;
      quantity: number;
      totals: { calories: number; protein: number; carbs: number; fat: number };
      warnings: string[];
    }> = [{
      food: bestSingle.food,
      quantity: bestSingle.quantity,
      totals: bestSingle.totals,
      warnings: bestSingle.warnings
    }];

    let chosenTotals = { ...bestSingle.totals };
    let chosenScore = bestSingle.score;

    const remainingCalories = target.calories - bestSingle.totals.calories;
    if (remainingCalories > 120) {
      const secondTarget = {
        calories: Math.max(0, remainingCalories),
        protein: Math.max(0, target.protein - bestSingle.totals.protein),
        carbs: Math.max(0, target.carbs - bestSingle.totals.carbs),
        fat: Math.max(0, target.fat - bestSingle.totals.fat)
      };

      const secondCandidates = scoredCandidates
        .filter((candidate) => candidate.food.id !== bestSingle.food.id)
        .map((candidate) => {
          if (candidate.food.calories <= 0) return null;
          const secondQuantity = clamp(secondTarget.calories / candidate.food.calories, 0.2, 2.25);
          const secondTotals = {
            calories: round2(candidate.food.calories * secondQuantity),
            protein: round2(candidate.food.protein * secondQuantity),
            carbs: round2(candidate.food.carbs * secondQuantity),
            fat: round2(candidate.food.fat * secondQuantity)
          };
          const combinedTotals = {
            calories: round2(bestSingle.totals.calories + secondTotals.calories),
            protein: round2(bestSingle.totals.protein + secondTotals.protein),
            carbs: round2(bestSingle.totals.carbs + secondTotals.carbs),
            fat: round2(bestSingle.totals.fat + secondTotals.fat)
          };
          const combinedScore = mealScore(combinedTotals, target);
          return {
            candidate,
            quantity: round2(secondQuantity),
            totals: secondTotals,
            combinedTotals,
            combinedScore
          };
        })
        .filter(
          (item): item is {
            candidate: ScoredFood;
            quantity: number;
            totals: { calories: number; protein: number; carbs: number; fat: number };
            combinedTotals: { calories: number; protein: number; carbs: number; fat: number };
            combinedScore: number;
          } => Boolean(item)
        )
        .sort((a, b) => a.combinedScore - b.combinedScore);

      const bestSecond = secondCandidates[0];
      if (bestSecond && bestSecond.combinedScore < chosenScore * 0.92) {
        chosenFoods = [
          {
            food: bestSingle.food,
            quantity: bestSingle.quantity,
            totals: bestSingle.totals,
            warnings: bestSingle.warnings
          },
          {
            food: bestSecond.candidate.food,
            quantity: bestSecond.quantity,
            totals: bestSecond.totals,
            warnings: bestSecond.candidate.warnings
          }
        ];
        chosenTotals = bestSecond.combinedTotals;
        chosenScore = bestSecond.combinedScore;
      }
    }

    acc.push({
      mealId: meal.id,
      mealName: meal.name,
      mealTime: meal.time,
      target,
      totals: chosenTotals,
      items: chosenFoods.map((item) => ({
        foodId: item.food.id,
        foodName: item.food.name,
        quantity: item.quantity,
        calories: item.totals.calories,
        protein: item.totals.protein,
        carbs: item.totals.carbs,
        fat: item.totals.fat,
        warnings: item.warnings
      })),
      passesDietaryFilters: chosenFoods.every((item) => item.warnings.length === 0)
    });

    return acc;
  }, []);

  if (!plannedMeals.length) return null;

  const totals = plannedMeals.reduce(
    (sum, meal) => ({
      calories: round2(sum.calories + meal.totals.calories),
      protein: round2(sum.protein + meal.totals.protein),
      carbs: round2(sum.carbs + meal.totals.carbs),
      fat: round2(sum.fat + meal.totals.fat)
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const passCount = plannedMeals.filter((meal) => meal.passesDietaryFilters).length;
  const dietaryPassRate = plannedMeals.length > 0 ? (passCount / plannedMeals.length) * 100 : 0;

  return {
    createdAt: new Date().toISOString(),
    meals: plannedMeals,
    dietaryPassRate: round2(dietaryPassRate),
    summary: {
      targetCalories: round2(dailyTargets.calories),
      plannedCalories: totals.calories,
      targetProtein: round2(dailyTargets.protein),
      plannedProtein: totals.protein,
      targetCarbs: round2(dailyTargets.carbs),
      plannedCarbs: totals.carbs,
      targetFat: round2(dailyTargets.fat),
      plannedFat: totals.fat,
      caloriesWithin10Percent: buildMacroPercentCheck(dailyTargets.calories, totals.calories),
      proteinWithin10Percent: buildMacroPercentCheck(dailyTargets.protein, totals.protein),
      carbsWithin10Percent: buildMacroPercentCheck(dailyTargets.carbs, totals.carbs),
      fatWithin10Percent: buildMacroPercentCheck(dailyTargets.fat, totals.fat)
    }
  };
};