import React, { useEffect, useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, type Food } from '../../../lib/db';
import { calculateRecipeNutrition } from '../../../lib/recipes';
import { generateId } from '../../../lib';
import {
  generateSpoonacularDailyMealPlan,
  getSpoonacularRecipeSummary,
  searchSpoonacularRecipes,
  type SpoonacularDailyMealPlan,
  type SpoonacularMealSuggestion,
  type SpoonacularRecipeSummary
} from '../../../lib/spoonacular';
import { supabase } from '../../../lib/supabaseClient';
import { analyzeEaaRatio, type EaaInputItem } from '../../../lib/eaa';
import { fetchGeminiRecipeIngredients } from '../../../lib/gemini';

const DEFAULT_EAA_TO_PROTEIN_RATIO = 0.35;

const analyzeEaaFitAgainstProteinGoal = (
  items: EaaInputItem[],
  proteinGoalGrams: number,
  eaaToProteinRatio = DEFAULT_EAA_TO_PROTEIN_RATIO
) => {
  const analysis = analyzeEaaRatio(items);
  const proteinTarget = Number.isFinite(proteinGoalGrams) && proteinGoalGrams > 0 ? proteinGoalGrams : 0;
  const normalizedRatio = Number.isFinite(eaaToProteinRatio) && eaaToProteinRatio >= 0
    ? eaaToProteinRatio
    : DEFAULT_EAA_TO_PROTEIN_RATIO;
  const eaaTarget = proteinTarget * normalizedRatio;

  return {
    fitPercent: eaaTarget > 0 ? Math.max(0, Math.min(100, (analysis.eaaTotal / eaaTarget) * 100)) : 100
  };
};

interface SelectedIngredient {
  food: Food;
  quantity: number;
}

interface AiRecipeIngredient {
  name: string;
  amount: number;
  unit: string;
}

interface RankedMealSuggestion extends SpoonacularMealSuggestion {
  recipe: SpoonacularRecipeSummary;
  score: number;
  eaaFitPercent: number;
}

interface ImportedRecipeFood {
  id: string;
  name: string;
  importedAt: string;
}

interface ShoppingListItem {
  key: string;
  name: string;
  amount: number;
  unit: string;
  checked: boolean;
  fromMeals: string[];
}

const normalizeIngredientName = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(chopped|diced|minced|fresh|optional|to taste)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeUnit = (value: string) => {
  const unit = value.trim().toLowerCase();
  if (['gram', 'grams', 'g'].includes(unit)) return 'g';
  if (['milliliter', 'milliliters', 'ml'].includes(unit)) return 'ml';
  if (['ounce', 'ounces', 'oz'].includes(unit)) return 'oz';
  if (['tablespoon', 'tablespoons', 'tbsp'].includes(unit)) return 'tbsp';
  if (['teaspoon', 'teaspoons', 'tsp'].includes(unit)) return 'tsp';
  if (['cup', 'cups'].includes(unit)) return 'cup';
  if (['piece', 'pieces', 'pc', 'count', 'unit', 'units', 'item', 'items'].includes(unit)) return 'serving';
  return unit || 'serving';
};

type UnitCategory = 'mass' | 'volume' | 'count' | 'unknown';

const MASS_TO_GRAMS: Record<string, number> = {
  g: 1,
  oz: 28.3495
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  tsp: 4.92892,
  tbsp: 14.7868,
  cup: 240
};

const getUnitCategory = (unit: string): UnitCategory => {
  if (unit === 'serving') return 'count';
  if (MASS_TO_GRAMS[unit]) return 'mass';
  if (VOLUME_TO_ML[unit]) return 'volume';
  return 'unknown';
};

const convertAmountBetweenUnits = (amount: number, fromUnitRaw: string, toUnitRaw: string): number | null => {
  const fromUnit = normalizeUnit(fromUnitRaw);
  const toUnit = normalizeUnit(toUnitRaw);

  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (fromUnit === toUnit) return amount;

  const fromCategory = getUnitCategory(fromUnit);
  const toCategory = getUnitCategory(toUnit);
  if (fromCategory !== toCategory) return null;

  if (fromCategory === 'mass') {
    const fromFactor = MASS_TO_GRAMS[fromUnit];
    const toFactor = MASS_TO_GRAMS[toUnit];
    if (!fromFactor || !toFactor) return null;
    return (amount * fromFactor) / toFactor;
  }

  if (fromCategory === 'volume') {
    const fromFactor = VOLUME_TO_ML[fromUnit];
    const toFactor = VOLUME_TO_ML[toUnit];
    if (!fromFactor || !toFactor) return null;
    return (amount * fromFactor) / toFactor;
  }

  if (fromCategory === 'count') {
    return amount;
  }

  return null;
};

const didUseUnitFallback = (
  sourceAmount: number,
  sourceUnitRaw: string,
  servingUnitRaw: string
): boolean => {
  const safeAmount = Number.isFinite(sourceAmount) ? Math.max(0.01, sourceAmount) : 1;
  return convertAmountBetweenUnits(safeAmount, sourceUnitRaw, servingUnitRaw) === null;
};

const toServingMultiplier = (
  sourceAmount: number,
  sourceUnitRaw: string,
  servingSize: number,
  servingUnitRaw: string
): number => {
  const safeAmount = Number.isFinite(sourceAmount) ? Math.max(0.01, sourceAmount) : 1;
  const safeServingSize = Number.isFinite(servingSize) && servingSize > 0 ? servingSize : 1;

  const convertedAmount = convertAmountBetweenUnits(safeAmount, sourceUnitRaw, servingUnitRaw);
  if (convertedAmount !== null) {
    return Math.max(0.01, roundTo3(convertedAmount / safeServingSize));
  }

  return Math.max(0.01, roundTo3(safeAmount));
};

const toPositiveNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

const roundTo3 = (value: number) => Math.round(value * 1000) / 1000;

const toSafeNumber = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

const SPOONACULAR_DIET_PRIORITY = ['vegan', 'pescatarian', 'veg', 'eggetarian', 'jain'] as const;

const SPOONACULAR_DIET_BY_TAG: Record<string, string> = {
  vegan: 'vegan',
  pescatarian: 'pescetarian',
  veg: 'vegetarian',
  eggetarian: 'vegetarian',
  jain: 'vegetarian'
};

const resolveSpoonacularDietFromTags = (dietTags: string[] | undefined): string | undefined => {
  const tags = (dietTags || []).map((item) => String(item || '').trim().toLowerCase());
  const matched = SPOONACULAR_DIET_PRIORITY.find((tag) => tags.includes(tag));
  if (!matched) return undefined;
  return SPOONACULAR_DIET_BY_TAG[matched];
};

const resolveProteinTarget = (settingsRow: unknown): number => {
  const targetProtein = Number((settingsRow as any)?.nutrition?.proteinTargetGrams);
  if (Number.isFinite(targetProtein) && targetProtein > 0) return targetProtein;

  const calorieBudget = Number((settingsRow as any)?.nutrition?.calorieBudget);
  const proteinPercent = Number((settingsRow as any)?.nutrition?.proteinPercent);
  if (Number.isFinite(calorieBudget) && calorieBudget > 0 && Number.isFinite(proteinPercent) && proteinPercent >= 0) {
    return Math.max(1, Math.round((calorieBudget * (proteinPercent / 100)) / 4));
  }

  return 150;
};

const resolveEaaTargetRatio = (settingsRow: unknown): number => {
  const ratioFromPercent = Number((settingsRow as any)?.nutrition?.eaaTargetPercent) / 100;
  if (Number.isFinite(ratioFromPercent) && ratioFromPercent >= 0) return ratioFromPercent;
  return DEFAULT_EAA_TO_PROTEIN_RATIO;
};

const calculateGoalFocusScoreAdjustment = (
  goalFocus: string,
  calories: number,
  protein: number,
  perMealCaloriesTarget: number,
  perMealProteinTarget: number
): number => {
  const normalizedFocus = String(goalFocus || '').trim().toLowerCase();
  if (!normalizedFocus) return 0;

  const safeCalories = Math.max(1, calories);
  const proteinDensity = protein / safeCalories;

  if (normalizedFocus === 'muscle_gain') {
    const caloriesGap = Math.abs(calories - perMealCaloriesTarget * 1.05) / Math.max(1, perMealCaloriesTarget);
    const proteinBonus = Math.min(0.12, proteinDensity * 7);
    return caloriesGap * 0.28 - proteinBonus;
  }

  if (normalizedFocus === 'fat_loss') {
    const caloriePenalty = calories > perMealCaloriesTarget ? (calories - perMealCaloriesTarget) / Math.max(1, perMealCaloriesTarget) : 0;
    const proteinBonus = Math.min(0.14, proteinDensity * 8.5);
    return caloriePenalty * 0.42 - proteinBonus;
  }

  if (normalizedFocus === 'recomp') {
    const caloriesGap = Math.abs(calories - perMealCaloriesTarget) / Math.max(1, perMealCaloriesTarget);
    const proteinBonus = Math.min(0.1, proteinDensity * 7);
    return caloriesGap * 0.25 - proteinBonus;
  }

  return 0;
};

const rankMealSuggestions = (
  meals: SpoonacularMealSuggestion[],
  mealDetails: SpoonacularRecipeSummary[],
  options: {
    dailyCaloriesTarget: number;
    dailyProteinTarget: number;
    eaaTargetRatio: number;
    goalFocus: string;
    prioritizeEaa: boolean;
  }
): RankedMealSuggestion[] => {
  const mealCount = Math.max(1, meals.length);
  const perMealCaloriesTarget = options.dailyCaloriesTarget / mealCount;
  const perMealProteinTarget = options.dailyProteinTarget / mealCount;

  return meals
    .map((meal) => {
      const recipe = mealDetails.find((item) => item.id === meal.id);
      if (!recipe) return null;

      const calorieError = Math.abs(recipe.calories - perMealCaloriesTarget) / Math.max(1, perMealCaloriesTarget);
      const proteinError = Math.abs(recipe.protein - perMealProteinTarget) / Math.max(1, perMealProteinTarget);

      const eaaFitPercent = analyzeEaaFitAgainstProteinGoal(
        [{ proteinGrams: recipe.protein, amountConsumed: 1, micros: recipe.micros }],
        perMealProteinTarget,
        options.eaaTargetRatio
      ).fitPercent;
      const eaaPenalty = options.prioritizeEaa ? (100 - eaaFitPercent) / 100 : 0;

      const goalAdjustment = calculateGoalFocusScoreAdjustment(
        options.goalFocus,
        recipe.calories,
        recipe.protein,
        perMealCaloriesTarget,
        perMealProteinTarget
      );

      const score = calorieError * 0.5 + proteinError * 0.65 + eaaPenalty * 0.8 + goalAdjustment;

      return {
        ...meal,
        recipe,
        eaaFitPercent,
        score
      };
    })
    .filter((item): item is RankedMealSuggestion => Boolean(item))
    .sort((a, b) => a.score - b.score);
};

const normalizeShoppingKey = (name: string, unit: string) =>
  `${name.trim().toLowerCase()}::${unit.trim().toLowerCase()}`;

const round2 = (value: number) => Math.round(value * 100) / 100;

const buildShoppingListItems = (rankedMeals: RankedMealSuggestion[]): ShoppingListItem[] => {
  const consolidated = rankedMeals.reduce<Record<string, ShoppingListItem>>((acc, meal) => {
    const recipeServings = Math.max(1, Number(meal.recipe.servings) || 1);
    const targetServings = Math.max(1, Number(meal.servings) || 1);
    const servingScale = targetServings / recipeServings;

    meal.recipe.ingredients.forEach((ingredient) => {
      const baseAmount = Number(ingredient.amount) || 0;
      const amount = baseAmount > 0 ? baseAmount * servingScale : 1 * servingScale;
      const unit = ingredient.unit?.trim() || 'unit';
      const key = normalizeShoppingKey(ingredient.name, unit);

      if (!acc[key]) {
        acc[key] = {
          key,
          name: ingredient.name,
          amount,
          unit,
          checked: false,
          fromMeals: [meal.title]
        };
      } else {
        acc[key].amount += amount;
        if (!acc[key].fromMeals.includes(meal.title)) {
          acc[key].fromMeals.push(meal.title);
        }
      }
    });

    return acc;
  }, {});

  return Object.values(consolidated)
    .map((item) => ({ ...item, amount: round2(item.amount) }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export default function CreateRecipe() {
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Basic Form State
  const [recipeName, setRecipeName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIngredients, setSelectedIngredients] = useState<SelectedIngredient[]>([]);
  const [isFetchingAiRecipe, setIsFetchingAiRecipe] = useState(false);
  const [spoonacularQuery, setSpoonacularQuery] = useState('');
  const [spoonacularResults, setSpoonacularResults] = useState<SpoonacularRecipeSummary[]>([]);
  const [isSearchingSpoonacular, setIsSearchingSpoonacular] = useState(false);
  const [isImportingSpoonacularId, setIsImportingSpoonacularId] = useState<number | null>(null);
  const [mealPlan, setMealPlan] = useState<SpoonacularDailyMealPlan | null>(null);
  const [isGeneratingMealPlan, setIsGeneratingMealPlan] = useState(false);
  const [importedRecipeFoods, setImportedRecipeFoods] = useState<ImportedRecipeFood[]>([]);
  const [shoppingListItems, setShoppingListItems] = useState<ShoppingListItem[]>([]);
  const [shoppingListStatus, setShoppingListStatus] = useState<string>('');
  const [isBuildingShoppingList, setIsBuildingShoppingList] = useState(false);
  
  // Search Modal State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Live Query for Search Results
  const searchResults = useLiveQuery(async () => {
    if (!searchQuery) return [];
    return await db.foods
      .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .limit(10)
      .toArray();
  }, [searchQuery]);

  // Derived State (Replaces $: declarations)
  const recipeStats = useMemo(() => 
    calculateRecipeNutrition(selectedIngredients), 
  [selectedIngredients]);

  const settingsRow = useLiveQuery(async () => db.settings.get('local-settings'), []);
  const profileRow = useLiveQuery(
    async () => {
      if (!currentUserId) return undefined;
      return db.profiles.get(currentUserId);
    },
    [currentUserId],
    undefined
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? null);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const mealPlanTargetCalories = useMemo(() => {
    const targetCalories = Number((settingsRow as any)?.nutrition?.calorieBudget);
    if (Number.isFinite(targetCalories) && targetCalories > 0) return Math.round(targetCalories);

    const settingsCalories = Number((settingsRow as any)?.nutrition?.calorieBudget);
    if (Number.isFinite(settingsCalories) && settingsCalories > 0) return Math.round(settingsCalories);

    return 2000;
  }, [settingsRow]);

  const mealPlanDiet = useMemo(() => {
    const profileDiet = resolveSpoonacularDietFromTags(profileRow?.diet_tags);
    return profileDiet;
  }, [profileRow]);
  const dailyProteinTarget = useMemo(() => resolveProteinTarget(settingsRow), [settingsRow]);
  const eaaTargetRatio = useMemo(() => resolveEaaTargetRatio(settingsRow), [settingsRow]);
  const goalFocus = useMemo(() => String((profileRow as any)?.goal_focus || '').trim(), [profileRow]);
  const prioritizeEaa = useMemo(() => eaaTargetRatio > 0, [eaaTargetRatio]);

  const [rankedMealSuggestions, setRankedMealSuggestions] = useState<RankedMealSuggestion[]>([]);

  const saveSpoonacularRecipeAsFood = async (recipe: SpoonacularRecipeSummary) => {
    const now = new Date();
    const foodId = generateId();

    await db.transaction('rw', db.foods, db.food_ingredients, async () => {
      const ingredientRows = recipe.ingredients || [];
      const ingredientLinks: Array<{
        id: string;
        parent_food_id: string;
        child_food_id: string;
        quantity: number;
        created_at: Date;
        synced: number;
      }> = [];
      const fallbackIngredients = new Set<string>();

      for (const ingredient of ingredientRows) {
        const ingredientName = String(ingredient.name || '').trim();
        if (!ingredientName) continue;

        const ingredientFood = await findOrCreateIngredientFood(
          {
            name: ingredientName,
            amount: Number(ingredient.amount) || 1,
            unit: ingredient.unit || 'serving'
          },
          'spoonacular'
        );
        if (!ingredientFood) continue;

        const amount = Math.max(0.01, Number(ingredient.amount) || 1);
        const ingredientServingSize = Number(ingredientFood.serving_size) > 0 ? Number(ingredientFood.serving_size) : 1;
        if (didUseUnitFallback(amount, ingredient.unit || 'serving', ingredientFood.serving_unit || 'serving')) {
          fallbackIngredients.add(ingredientName);
        }
        const quantity = toServingMultiplier(
          amount,
          ingredient.unit || 'serving',
          ingredientServingSize,
          ingredientFood.serving_unit || 'serving'
        );

        ingredientLinks.push({
          id: generateId(),
          parent_food_id: foodId,
          child_food_id: ingredientFood.id,
          quantity: Math.max(0.01, quantity),
          created_at: now,
          synced: 0
        });
      }

      const food: Food = {
        id: foodId,
        name: recipe.title,
        brand: 'Spoonacular',
        calories: toSafeNumber(recipe.calories),
        protein: toSafeNumber(recipe.protein),
        carbs: toSafeNumber(recipe.carbs),
        fat: toSafeNumber(recipe.fat),
        serving_size: 1,
        serving_unit: 'serving',
        micros: recipe.micros || {},
        is_recipe: true,
        ai_notes: [
          `Imported from Spoonacular recipe ID ${recipe.id}.`,
          recipe.sourceUrl ? `Source: ${recipe.sourceUrl}` : null,
          `Servings returned by API: ${recipe.servings}`,
          recipe.ingredients?.length ? `Ingredients imported: ${recipe.ingredients.length}` : null,
          fallbackIngredients.size > 0
            ? `Unit conversion fallback ingredients: ${[...fallbackIngredients].join(', ')}`
            : null
        ]
          .filter(Boolean)
          .join('\n'),
        created_at: now,
        updated_at: now,
        synced: 0
      };

      await db.foods.add(food);

      if (ingredientLinks.length > 0) {
        await db.food_ingredients.bulkAdd(ingredientLinks);
      }
    });

    return {
      id: foodId,
      name: recipe.title
    };
  };

  const runSpoonacularRecipeSearch = async () => {
    const query = spoonacularQuery.trim();
    if (!query) return alert('Enter a recipe search query first.');

    setIsSearchingSpoonacular(true);
    try {
      const results = await searchSpoonacularRecipes(query, 8);
      setSpoonacularResults(results);
    } catch (error) {
      console.error('Failed to search Spoonacular recipes:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('auth') || message.toLowerCase().includes('token') || message.includes('401')) {
        alert('Sign in to use recipe import.');
      } else {
        alert('Failed to fetch recipes from Spoonacular.');
      }
    } finally {
      setIsSearchingSpoonacular(false);
    }
  };

  const importSpoonacularRecipe = async (recipeId: number) => {
    setIsImportingSpoonacularId(recipeId);
    try {
      const recipe = await getSpoonacularRecipeSummary(recipeId);
      const importedFood = await saveSpoonacularRecipeAsFood(recipe);
      setImportedRecipeFoods((prev) => [
        {
          id: importedFood.id,
          name: importedFood.name,
          importedAt: new Date().toISOString()
        },
        ...prev
      ].slice(0, 6));

      setRecipeName(recipe.title);
      if (!description.trim()) {
        setDescription(`Imported nutrition from Spoonacular for ${recipe.title}.`);
      }
    } catch (error) {
      console.error('Failed to import Spoonacular recipe:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('auth') || message.toLowerCase().includes('token') || message.includes('401')) {
        alert('Sign in to import recipes.');
      } else {
        alert('Failed to import recipe from Spoonacular.');
      }
    } finally {
      setIsImportingSpoonacularId(null);
    }
  };

  const generateMealPlanSuggestions = async () => {
    setIsGeneratingMealPlan(true);
    try {
      const nextPlan = await generateSpoonacularDailyMealPlan(mealPlanTargetCalories, mealPlanDiet);
      setMealPlan(nextPlan);

      const detailedMeals = await Promise.all(
        nextPlan.meals.map((meal) => getSpoonacularRecipeSummary(meal.id))
      );

      const ranked = rankMealSuggestions(nextPlan.meals, detailedMeals, {
        dailyCaloriesTarget: mealPlanTargetCalories,
        dailyProteinTarget,
        eaaTargetRatio,
        goalFocus,
        prioritizeEaa
      });
      setRankedMealSuggestions(ranked);
      const autoBuiltItems = buildShoppingListItems(ranked);
      setShoppingListItems(autoBuiltItems);
      setShoppingListStatus(
        autoBuiltItems.length > 0
          ? `Shopping list ready with ${autoBuiltItems.length} items.`
          : 'Meal suggestions generated, but ingredient details were limited. Click Build Shopping List to retry.'
      );
    } catch (error) {
      console.error('Failed to generate Spoonacular meal plan:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('auth') || message.toLowerCase().includes('token') || message.includes('401')) {
        alert('Sign in to generate meal suggestions.');
      } else {
        alert('Failed to generate meal plan suggestions.');
      }
    } finally {
      setIsGeneratingMealPlan(false);
    }
  };

  const buildShoppingListPlanner = async () => {
    let sourceMeals = rankedMealSuggestions;
    if (sourceMeals.length === 0 && !mealPlan?.meals?.length) {
      alert('Generate daily meal suggestions first.');
      return;
    }

    setIsBuildingShoppingList(true);
    setShoppingListStatus('Building shopping list...');

    try {
      if (sourceMeals.length === 0 && mealPlan?.meals?.length) {
        const details = await Promise.all(
          mealPlan.meals.map((meal) => getSpoonacularRecipeSummary(meal.id))
        );
        sourceMeals = rankMealSuggestions(mealPlan.meals, details, {
          dailyCaloriesTarget: mealPlanTargetCalories,
          dailyProteinTarget,
          eaaTargetRatio,
          goalFocus,
          prioritizeEaa
        });
        setRankedMealSuggestions(sourceMeals);
      }

      let items = buildShoppingListItems(sourceMeals);

      const needsIngredientRetry = items.length === 0 || sourceMeals.every((meal) => meal.recipe.ingredients.length === 0);
      if (needsIngredientRetry && sourceMeals.length > 0) {
        const refreshedDetails = await Promise.all(
          sourceMeals.map((meal) => getSpoonacularRecipeSummary(meal.id))
        );

        sourceMeals = rankMealSuggestions(sourceMeals, refreshedDetails, {
          dailyCaloriesTarget: mealPlanTargetCalories,
          dailyProteinTarget,
          eaaTargetRatio,
          goalFocus,
          prioritizeEaa
        });
        setRankedMealSuggestions(sourceMeals);
        items = buildShoppingListItems(sourceMeals);
      }

      if (items.length === 0) {
        setShoppingListItems([]);
        setShoppingListStatus('Could not build list: Spoonacular did not return ingredient details for these meals.');
        return;
      }

      setShoppingListItems(items);
      setShoppingListStatus(`Shopping list built with ${items.length} items.`);
    } catch (error) {
      console.error('Failed to build shopping list planner:', error);
      setShoppingListStatus('Failed to build shopping list. Try again.');
    } finally {
      setIsBuildingShoppingList(false);
    }

  };

  const toggleShoppingItem = (key: string) => {
    setShoppingListItems((prev) => prev.map((item) => (
      item.key === key ? { ...item, checked: !item.checked } : item
    )));
  };

  const findOrCreateIngredientFood = async (
    ingredient: AiRecipeIngredient,
    source: 'gemini' | 'spoonacular' = 'gemini'
  ) => {
    const normalizedName = normalizeIngredientName(ingredient.name);
    const normalizedUnit = normalizeUnit(ingredient.unit);

    if (!normalizedName) return null;

    const foods = await db.foods
      .filter((food) => food.name.toLowerCase() === normalizedName.toLowerCase())
      .limit(1)
      .toArray();

    if (foods[0]) return foods[0];

    const now = new Date();
    const newFood: Food = {
      id: generateId(),
      name: normalizedName,
      brand: source === 'spoonacular' ? 'Spoonacular Ingredient' : 'AI Ingredient',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      serving_size: 1,
      serving_unit: normalizedUnit,
      micros: {},
      is_recipe: false,
      ai_notes:
        source === 'spoonacular'
          ? 'Auto-created from Spoonacular recipe import. Update nutrition when known.'
          : 'Auto-created from Gemini recipe import. Update nutrition when known.',
      created_at: now,
      updated_at: now,
      synced: 0
    };

    await db.foods.add(newFood);
    return newFood;
  };

  const fetchRecipeIngredients = async () => {
    if (!recipeName.trim()) return alert('Please enter a recipe name first');

    setIsFetchingAiRecipe(true);
    try {
      const payload = await fetchGeminiRecipeIngredients({ recipeName });
      const aiIngredientsRaw = Array.isArray(payload.ingredients) ? payload.ingredients : [];
      const aiIngredients: AiRecipeIngredient[] = aiIngredientsRaw
        .map((item) => {
          const record = (item || {}) as Record<string, unknown>;
          return {
            name: String(record.name || '').trim(),
            amount: toPositiveNumber(record.amount),
            unit: String(record.unit || '').trim()
          };
        })
        .filter((item) => item.name && item.amount > 0);

      if (!aiIngredients.length) {
        alert('No ingredients were returned by Gemini. Try a more specific recipe name.');
        return;
      }

      const selectedFromAi: SelectedIngredient[] = [];
      for (const ingredient of aiIngredients) {
        const food = await findOrCreateIngredientFood(ingredient);
        if (!food) continue;

        const servingSize = Number(food.serving_size) > 0 ? Number(food.serving_size) : 1;
        const quantity = toServingMultiplier(
          ingredient.amount,
          ingredient.unit,
          servingSize,
          food.serving_unit || 'serving'
        );

        selectedFromAi.push({
          food,
          quantity: Math.max(0.01, quantity)
        });
      }

      const mergedByFoodId = selectedFromAi.reduce<Record<string, SelectedIngredient>>((acc, item) => {
        if (!acc[item.food.id]) {
          acc[item.food.id] = { ...item };
        } else {
          acc[item.food.id].quantity = roundTo3(acc[item.food.id].quantity + item.quantity);
        }
        return acc;
      }, {});

      setSelectedIngredients(Object.values(mergedByFoodId));
      if (!description.trim()) {
        setDescription('Imported ingredient list from Gemini. Please review and adjust amounts.');
      }
    } catch (error) {
      console.error('Failed to fetch recipe ingredients:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('auth') || message.toLowerCase().includes('token') || message.includes('401')) {
        alert('Sign in to use AI recipe import.');
      } else {
        alert('Failed to fetch recipe ingredients from Gemini.');
      }
    } finally {
      setIsFetchingAiRecipe(false);
    }
  };

  // --- Actions ---
  const addIngredient = (food: Food) => {
    setSelectedIngredients(prev => [...prev, { food, quantity: 1 }]);
    setShowSearchModal(false);
    setSearchQuery('');
  };

  const removeIngredient = (index: number) => {
    setSelectedIngredients(prev => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, quantity: number) => {
    setSelectedIngredients(prev => prev.map((item, i) => 
      i === index ? { ...item, quantity: Math.max(0, quantity) } : item
    ));
  };

  const saveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeName) return alert('Please enter a recipe name');
    if (selectedIngredients.length === 0) return alert('Please add at least one ingredient');

    try {
      const recipeId = generateId();
      const now = new Date();
      await db.transaction('rw', db.foods, db.food_ingredients, async () => {
        const recipeFood: Food = {
          id: recipeId,
          name: recipeName,
          brand: 'Home Recipe',
          calories: recipeStats.calories,
          protein: recipeStats.protein,
          carbs: recipeStats.carbs,
          fat: recipeStats.fat,
          serving_size: recipeStats.weight,
          serving_unit: 'g',
          micros: {},
          is_recipe: true,
          ai_notes: description || undefined,
          created_at: now,
          updated_at: now,
          synced: 0
        };

        await db.foods.add(recipeFood);

        await db.food_ingredients.bulkAdd(
          selectedIngredients
            .filter((item) => item.quantity > 0)
            .map((item) => ({
              id: generateId(),
              parent_food_id: recipeId,
              child_food_id: item.food.id,
              quantity: item.quantity,
              created_at: now,
              synced: 0
            }))
        );
      });

      navigate('/foods');
    } catch (error) {
      console.error('Failed to save recipe:', error);
      alert('Failed to save recipe');
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Create New Recipe</h1>

      <div className="mb-4 rounded-xl border border-border-subtle bg-card p-3 space-y-3">
        <h2 className="text-sm font-bold text-text-main">Spoonacular Recipe Nutrition Logging</h2>

        <div className="flex gap-2">
          <input
            type="text"
            value={spoonacularQuery}
            onChange={(e) => setSpoonacularQuery(e.target.value)}
            placeholder="Search recipes (e.g. chicken curry)"
            className="flex-1 p-2 border rounded"
          />
          <button
            type="button"
            onClick={runSpoonacularRecipeSearch}
            disabled={isSearchingSpoonacular}
            className="px-3 py-2 rounded border border-border-subtle bg-surface text-text-main text-sm font-semibold disabled:opacity-60"
          >
            {isSearchingSpoonacular ? 'Searching…' : 'Search'}
          </button>
        </div>

        {spoonacularResults.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {spoonacularResults.map((result) => (
              <div key={result.id} className="rounded-lg border border-border-subtle bg-surface p-2">
                <div className="text-sm font-semibold text-text-main">{result.title}</div>
                <div className="text-xs text-text-muted mt-0.5">
                  {Math.round(result.calories)} kcal • P {Math.round(result.protein)}g • C {Math.round(result.carbs)}g • F {Math.round(result.fat)}g
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => importSpoonacularRecipe(result.id)}
                    disabled={isImportingSpoonacularId === result.id}
                    className="px-3 py-1.5 rounded bg-brand text-brand-fg text-xs font-semibold disabled:opacity-60"
                  >
                    {isImportingSpoonacularId === result.id ? 'Importing…' : 'Import Nutrition'}
                  </button>
                  {result.sourceUrl && (
                    <a
                      href={result.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-text-muted underline"
                    >
                      Source
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {importedRecipeFoods.length > 0 && (
          <div className="rounded-lg border border-brand/30 bg-brand/10 p-2.5 space-y-2">
            <div className="text-xs font-semibold text-text-main">
              Imported as recipe foods ({importedRecipeFoods.length})
            </div>
            <div className="space-y-1">
              {importedRecipeFoods.map((item) => (
                <div key={item.id} className="text-xs text-text-main flex items-center justify-between gap-2">
                  <span className="truncate">{item.name}</span>
                  <span className="text-text-muted">Saved</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <a href="#/foods" className="underline text-text-main">Open Foods</a>
              <a href="#/log/add" className="underline text-text-main">Go to Add Log</a>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-border-subtle bg-card p-3 space-y-3">
        <h2 className="text-sm font-bold text-text-main">Basic Meal Plan Suggestions</h2>
        <div className="grid grid-cols-2 gap-2 text-xs text-text-muted">
          <div className="rounded border border-border-subtle bg-surface px-2 py-2">
            Target calories: <span className="font-semibold text-text-main">{mealPlanTargetCalories}</span>
          </div>
          <div className="rounded border border-border-subtle bg-surface px-2 py-2">
            Diet preference: <span className="font-semibold text-text-main">{mealPlanDiet || 'No profile diet filter'}</span>
          </div>
          <div className="rounded border border-border-subtle bg-surface px-2 py-2">
            Goal focus: <span className="font-semibold text-text-main">{goalFocus || 'None'}</span>
          </div>
          <div className="rounded border border-border-subtle bg-surface px-2 py-2">
            Protein / EAA: <span className="font-semibold text-text-main">{Math.round(dailyProteinTarget)}g / {Math.round(eaaTargetRatio * 100)}%</span>
          </div>
        </div>
        <button
          type="button"
          onClick={generateMealPlanSuggestions}
          disabled={isGeneratingMealPlan}
          className="w-full px-3 py-2 rounded border border-border-subtle bg-surface text-text-main text-sm font-semibold disabled:opacity-60"
        >
          {isGeneratingMealPlan ? 'Generating…' : 'Generate Daily Suggestions'}
        </button>

        {rankedMealSuggestions.length > 0 && (
          <button
            type="button"
            onClick={buildShoppingListPlanner}
            disabled={isBuildingShoppingList}
            className="w-full px-3 py-2 rounded border border-border-subtle bg-surface text-text-main text-sm font-semibold disabled:opacity-60"
          >
            {isBuildingShoppingList ? 'Building Shopping List…' : 'Build Shopping List Planner'}
          </button>
        )}

        {shoppingListStatus && (
          <div className="text-xs text-text-muted">{shoppingListStatus}</div>
        )}

        {mealPlan && (
          <div className="space-y-2">
            <div className="text-xs text-text-muted">
              Daily target from API: {Math.round(mealPlan.totals.calories)} kcal • P {Math.round(mealPlan.totals.protein)}g • C {Math.round(mealPlan.totals.carbs)}g • F {Math.round(mealPlan.totals.fat)}g
            </div>
            {(rankedMealSuggestions.length > 0 ? rankedMealSuggestions : mealPlan.meals).map((meal) => {
              const rankedMeal = (meal as RankedMealSuggestion);
              const nutritionLine = rankedMeal.recipe
                ? `${Math.round(rankedMeal.recipe.calories)} kcal • P ${Math.round(rankedMeal.recipe.protein)}g • C ${Math.round(rankedMeal.recipe.carbs)}g • F ${Math.round(rankedMeal.recipe.fat)}g`
                : null;

              return (
              <div key={meal.id} className="rounded-lg border border-border-subtle bg-surface p-2">
                <div className="text-sm font-semibold text-text-main">{meal.title}</div>
                <div className="text-xs text-text-muted">{meal.readyInMinutes} min • {meal.servings} servings</div>
                {nutritionLine && <div className="text-xs text-text-muted mt-1">{nutritionLine}</div>}
                {rankedMeal.recipe && (
                  <div className="text-xs text-text-muted mt-1">
                    EAA fit: {Math.round(rankedMeal.eaaFitPercent)}% {prioritizeEaa ? '• EAA preference enabled' : ''}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => importSpoonacularRecipe(meal.id)}
                    disabled={isImportingSpoonacularId === meal.id}
                    className="px-3 py-1.5 rounded bg-brand text-brand-fg text-xs font-semibold disabled:opacity-60"
                  >
                    {isImportingSpoonacularId === meal.id ? 'Importing…' : 'Import as Recipe Food'}
                  </button>
                  {meal.sourceUrl && (
                    <a href={meal.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-text-muted underline">
                      Source
                    </a>
                  )}
                </div>
              </div>
            );})}
          </div>
        )}

        {shoppingListItems.length > 0 && (
          <div className="rounded-lg border border-border-subtle bg-surface p-3 space-y-2">
            <div className="text-sm font-semibold text-text-main">Shopping List Planner</div>
            <div className="text-xs text-text-muted">
              {shoppingListItems.filter((item) => !item.checked).length} remaining • {shoppingListItems.length} total items
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {shoppingListItems.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-xs text-text-main">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleShoppingItem(item.key)}
                    className="mt-0.5"
                  />
                  <span className={item.checked ? 'line-through text-text-muted' : ''}>
                    {item.amount} {item.unit} {item.name}
                    <span className="text-text-muted"> ({item.fromMeals.join(', ')})</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {currentUserId && (
        <button
          type="button"
          onClick={fetchRecipeIngredients}
          disabled={isFetchingAiRecipe || !recipeName.trim()}
          className={`mb-4 w-full py-2 rounded font-semibold transition-colors ${
            isFetchingAiRecipe || !recipeName.trim()
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-brand text-brand-fg hover:opacity-90'
          }`}
        >
          {isFetchingAiRecipe ? 'Fetching Recipe…' : '✨ Fetch Ingredients from Gemini'}
        </button>
      )}
      
      <form onSubmit={saveRecipe} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Recipe Name</label>
          <input 
            type="text" 
            required 
            value={recipeName} 
            onChange={(e) => setRecipeName(e.target.value)}
            className="w-full p-2 border rounded" 
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description (optional)</label>
          <textarea 
            value={description} 
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Ingredients</label>
          <button 
            type="button" 
            onClick={() => setShowSearchModal(true)}
            className="bg-blue-500 text-white px-3 py-1 rounded mb-2 block"
          >
            Add Ingredient
          </button>
          
          <ul className="mb-2 space-y-2">
            {selectedIngredients.map((ing, i) => (
              <li key={`${ing.food.id}-${i}`} className="flex items-center justify-between bg-surface p-2 rounded border border-border-subtle">
                <div className="flex flex-col">
                  <span className="font-medium">{ing.food.name}</span>
                  <span className="text-xs text-text-muted">
                    Unit: {ing.food.serving_size}{ing.food.serving_unit}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    min={0}
                    step="0.01"
                    value={ing.quantity}
                    onChange={(e) => updateQuantity(i, Number(e.target.value))}
                    className="w-16 p-1 border rounded text-center"
                  />
                  <button 
                    type="button" 
                    onClick={() => removeIngredient(i)}
                    className="text-red-500 text-xl px-2"
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Nutrition Summary */}
        <div className="grid grid-cols-2 gap-4 bg-card p-4 rounded-xl border border-border-subtle">
          <NutrientField label="Total Calories" value={recipeStats.calories} />
          <NutrientField label="Total Protein (g)" value={recipeStats.protein} />
          <NutrientField label="Total Carbs (g)" value={recipeStats.carbs} />
          <NutrientField label="Total Fat (g)" value={recipeStats.fat} />
        </div>

        <button 
          type="submit" 
          className="w-full bg-green-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-green-700 transition shadow-sm mt-4"
        >
          Save Recipe
        </button>
      </form>

      {/* Search Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Add Ingredient</h2>
            <input 
              type="text" 
              autoFocus
              placeholder="Search foods..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full p-2 border rounded mb-4" 
            />
            
            <div className="max-h-64 overflow-y-auto border rounded divide-y">
              {searchResults?.length ? (
                searchResults.map(food => (
                  <div 
                    key={food.id}
                    onClick={() => addIngredient(food)}
                    className="p-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors"
                  >
                    <span>{food.name}</span>
                    <span className="text-xs text-text-muted">{food.brand}</span>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-gray-500 italic">
                  {searchQuery ? 'No foods found' : 'Type to search foods...'}
                </div>
              )}
            </div>
            
            <button 
              className="mt-6 w-full py-2 bg-gray-100 rounded font-medium hover:bg-gray-200" 
              onClick={() => setShowSearchModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple internal component for read-only fields
function NutrientField({ label, value }: { label: string, value: number }) {
  return (
    <div>
      <label className="block text-xs font-bold text-text-muted uppercase mb-1">{label}</label>
      <input 
        type="number" 
        value={Math.round(value)} 
        readOnly 
        className="w-full p-2 border rounded bg-gray-50 font-mono" 
      />
    </div>
  );
}