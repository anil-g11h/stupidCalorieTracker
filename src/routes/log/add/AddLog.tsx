    import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Food } from '../../../lib/db';
import { generateId } from '../../../lib';
    import { analyzeEaaRatio, scoreFoodForEaaDeficit, type EaaRatioGroupKey } from '../../../lib/eaa';
import { supabase } from '../../../lib/supabaseClient';
import {
  getDietaryConflictWarnings,
  hasDietaryPreferences,
  normalizeDietaryPreferences
} from '../../../lib/dietaryProfile';

const WEIGHT_BASED_REGEX = /^(g|ml|oz)$/i;

const EAA_GROUP_LABELS: Record<EaaRatioGroupKey, string> = {
  leucine: 'Leucine',
  lysine: 'Lysine',
  valineIsoleucine: 'Valine + Isoleucine',
  rest: 'Other EAAs'
};

const EAA_GROUP_SHORT_LABELS: Record<EaaRatioGroupKey, string> = {
  leucine: 'Leucine',
  lysine: 'Lysine',
  valineIsoleucine: 'Val+Iso',
  rest: 'Rest EAAs'
};

type FoodSortOption = 'default' | 'recent' | 'frequent' | 'protein';

const MICRONUTRIENT_META = [
  { key: 'vitamin_a', label: 'Vitamin A', unit: 'mcg', aliases: ['vitamin a', 'retinol', 'vitamin a rae'] },
  { key: 'vitamin_c', label: 'Vitamin C', unit: 'mg', aliases: ['vitamin c', 'ascorbic acid'] },
  { key: 'vitamin_d', label: 'Vitamin D', unit: 'mcg', aliases: ['vitamin d', 'vitamin d3', 'cholecalciferol'] },
  { key: 'vitamin_e', label: 'Vitamin E', unit: 'mg', aliases: ['vitamin e', 'alpha tocopherol', 'tocopherol'] },
  { key: 'vitamin_b12', label: 'Vitamin B12', unit: 'mcg', aliases: ['vitamin b12', 'b12', 'cobalamin'] },
  { key: 'vitamin_b6', label: 'Vitamin B6', unit: 'mg', aliases: ['vitamin b6', 'b6', 'pyridoxine'] },
  { key: 'folate_b9', label: 'Folate (B9)', unit: 'mcg', aliases: ['folate', 'vitamin b9', 'folic acid', 'b9'] },
  { key: 'calcium', label: 'Calcium', unit: 'mg', aliases: ['calcium'] },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', aliases: ['magnesium'] },
  { key: 'potassium', label: 'Potassium', unit: 'mg', aliases: ['potassium'] },
  { key: 'zinc', label: 'Zinc', unit: 'mg', aliases: ['zinc'] },
  { key: 'iron', label: 'Iron', unit: 'mg', aliases: ['iron'] },
  { key: 'sodium', label: 'Sodium', unit: 'mg', aliases: ['sodium', 'na'] },
  { key: 'iodine', label: 'Iodine', unit: 'mcg', aliases: ['iodine'] }
] as const;

function normalizeMicroKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, '');
}

function formatNutrientValue(value: number): string {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

function joinEaaGroupLabels(
  groups: EaaRatioGroupKey[],
  labels: Record<EaaRatioGroupKey, string> = EAA_GROUP_LABELS
): string {
  if (!groups.length) return 'Balanced';
  return groups.map((group) => labels[group]).join(' + ');
}

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
  const [sortOption, setSortOption] = useState<FoodSortOption>('frequent');
  const [addedCount, setAddedCount] = useState(0);
  const [addedFoodIds, setAddedFoodIds] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const settingsRow = useLiveQuery(async () => db.settings.get('local-settings'), []);
  const profileRow = useLiveQuery(
    async () => {
      if (!currentUserId) return undefined;
      return db.profiles.get(currentUserId);
    },
    [currentUserId],
    undefined
  );

  const dietaryPreferences = useMemo(() => normalizeDietaryPreferences(profileRow), [profileRow]);
  const hasDietaryProfile = useMemo(() => hasDietaryPreferences(dietaryPreferences), [dietaryPreferences]);

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

  const mealLogs = useLiveQuery(async () => {
    const normalizedMealType = mealType.trim().toLowerCase();
    const dayLogs = await db.logs.where('date').equals(date).toArray();
    return dayLogs.filter((log) => String(log.meal_type || '').trim().toLowerCase() === normalizedMealType);
  }, [date, mealType]);

  const mealLogIdsByFood = useMemo(() => {
    const logs = [...(mealLogs || [])].sort((a, b) => {
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
  }, [mealLogs]);

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

  const eaaDeficitTargeting = useMemo(() => {
    const ranked = (Object.entries(eaaDeficit) as Array<[EaaRatioGroupKey, number]>)
      .filter(([, grams]) => grams > 0)
      .sort((a, b) => b[1] - a[1]);

    const targetedGroups = ranked.slice(0, 2).map(([group]) => group);
    const totalDeficit = ranked.reduce((sum, [, grams]) => sum + grams, 0);

    return {
      ranked,
      targetedGroups,
      totalDeficit,
      summaryLabel: joinEaaGroupLabels(targetedGroups, EAA_GROUP_SHORT_LABELS)
    };
  }, [eaaDeficit]);

  const allLogs = useLiveQuery(async () => db.logs.toArray(), []);

  const logUsageByFood = useMemo(() => {
    const usageMap = new Map<string, { count: number; latestLoggedAt: number }>();

    (allLogs || []).forEach((log) => {
      const current = usageMap.get(log.food_id) || { count: 0, latestLoggedAt: 0 };
      const loggedAt = log.created_at ? new Date(log.created_at).getTime() : 0;
      usageMap.set(log.food_id, {
        count: current.count + 1,
        latestLoggedAt: Math.max(current.latestLoggedAt, loggedAt)
      });
    });

    return usageMap;
  }, [allLogs]);

  const rankedSearchResults = useMemo(() => {
    const base = [...(searchResults || [])];

    if (sortOption === 'recent') {
      return base.sort((a, b) => {
        const aCreatedAt = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bCreatedAt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bCreatedAt - aCreatedAt;
      });
    }

    if (sortOption === 'frequent') {
      return base.sort((a, b) => {
        const aUsage = logUsageByFood.get(a.id) || { count: 0, latestLoggedAt: 0 };
        const bUsage = logUsageByFood.get(b.id) || { count: 0, latestLoggedAt: 0 };

        if (bUsage.count !== aUsage.count) return bUsage.count - aUsage.count;
        if (bUsage.latestLoggedAt !== aUsage.latestLoggedAt) {
          return bUsage.latestLoggedAt - aUsage.latestLoggedAt;
        }
        return a.name.localeCompare(b.name);
      });
    }

    if (sortOption === 'protein') {
      return base.sort((a, b) => {
        if (b.protein !== a.protein) return b.protein - a.protein;
        return a.calories - b.calories;
      });
    }

    return base;
  }, [searchResults, sortOption, logUsageByFood]);

  const foodWarningsById = useLiveQuery(
    async () => {
      if (!hasDietaryProfile || rankedSearchResults.length === 0) return {} as Record<string, string[]>;

      const parentFoodIds = rankedSearchResults.map((food) => food.id);
      const ingredientRows = await db.food_ingredients.where('parent_food_id').anyOf(parentFoodIds).toArray();

      const childFoodIds = [...new Set(ingredientRows.map((item) => item.child_food_id))];
      const childFoods = childFoodIds.length > 0 ? await db.foods.where('id').anyOf(childFoodIds).toArray() : [];
      const childFoodNameById = childFoods.reduce<Record<string, string>>((acc, food) => {
        acc[food.id] = food.name;
        return acc;
      }, {});

      const ingredientNamesByParent = ingredientRows.reduce<Record<string, string[]>>((acc, row) => {
        if (!acc[row.parent_food_id]) acc[row.parent_food_id] = [];
        const ingredientName = childFoodNameById[row.child_food_id];
        if (ingredientName) acc[row.parent_food_id].push(ingredientName);
        return acc;
      }, {});

      return rankedSearchResults.reduce<Record<string, string[]>>((acc, food) => {
        const warnings = getDietaryConflictWarnings(dietaryPreferences, food, ingredientNamesByParent[food.id] || []);
        if (warnings.length > 0) {
          acc[food.id] = warnings;
        }
        return acc;
      }, {});
    },
    [rankedSearchResults, dietaryPreferences, hasDietaryProfile],
    {} as Record<string, string[]>
  );

  const selectedFoodWarnings = useLiveQuery(
    async () => {
      if (!hasDietaryProfile || !selectedFood) return [] as string[];

      const ingredientRows = await db.food_ingredients.where('parent_food_id').equals(selectedFood.id).toArray();
      const childFoodIds = [...new Set(ingredientRows.map((item) => item.child_food_id))];
      const childFoods = childFoodIds.length > 0 ? await db.foods.where('id').anyOf(childFoodIds).toArray() : [];
      const ingredientNames = childFoods.map((food) => food.name);

      return getDietaryConflictWarnings(dietaryPreferences, selectedFood, ingredientNames);
    },
    [selectedFood?.id, dietaryPreferences, hasDietaryProfile],
    [] as string[]
  );

  const eaaGuidance = useMemo(() => {
    if (!selectedFood) {
      return {
        targetedDeficitsText: 'No active EAA deficits for today.',
        helpsText: 'Select a food to see EAA guidance.',
        replacementText: 'Select a food to compare alternatives.'
      };
    }

    const guidanceQuantity = selectedUnit === 'serving'
      ? inputValue
      : (() => {
          const size = selectedFood.serving_size || 1;
          return size > 0 ? inputValue / size : inputValue;
        })();

    const selectedScore = scoreFoodForEaaDeficit(selectedFood.micros, eaaDeficit, guidanceQuantity);

    const helpedGroups = (Object.entries(selectedScore.filledByGroup) as Array<[EaaRatioGroupKey, number]>)
      .filter(([, grams]) => grams > 0)
      .sort((a, b) => b[1] - a[1]);

    const targetedDeficitsText = eaaDeficitTargeting.ranked.length
      ? eaaDeficitTargeting.ranked
          .slice(0, 2)
          .map(([group, grams]) => `${EAA_GROUP_LABELS[group]} (${formatNutrientValue(grams)}g)`)
          .join(' • ')
      : 'No meaningful EAA deficit detected today.';

    const helpsText = helpedGroups.length
      ? helpedGroups
          .slice(0, 2)
          .map(([group, grams]) => `${EAA_GROUP_LABELS[group]} +${formatNutrientValue(grams)}g`)
          .join(' • ')
      : 'This food does not materially close current EAA deficits at this amount.';

    const bestAlternative = [...(searchResults || [])]
      .filter((food) => food.id !== selectedFood.id)
      .map((food) => {
        const scoreData = scoreFoodForEaaDeficit(food.micros, eaaDeficit, guidanceQuantity);
        const bestGroup = (Object.entries(scoreData.filledByGroup) as Array<[EaaRatioGroupKey, number]>)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        return {
          food,
          score: scoreData.score,
          bestGroup
        };
      })
      .sort((a, b) => b.score - a.score)[0];

    const replacementText =
      eaaDeficitTargeting.totalDeficit <= 0
        ? 'No swap needed. Today looks balanced for EAAs.'
        : selectedScore.score <= 0 && (!bestAlternative || bestAlternative.score <= 0)
          ? 'Not enough EAA data to suggest a better replacement.'
          : bestAlternative && bestAlternative.score > selectedScore.score + 0.05
            ? `Consider ${bestAlternative.food.name} for stronger ${bestAlternative.bestGroup ? EAA_GROUP_LABELS[bestAlternative.bestGroup] : 'EAA'} support (+${formatNutrientValue(bestAlternative.score - selectedScore.score)}g).`
            : 'Current food is already a solid match for today’s EAA targets.';

    return {
      targetedDeficitsText,
      helpsText,
      replacementText
    };
  }, [selectedFood, selectedUnit, inputValue, eaaDeficit, eaaDeficitTargeting, searchResults]);

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

  const selectedFoodEaaQuality = useMemo(() => {
    if (!selectedFood) {
      return {
        eaaPercent: 0,
        eaaTotal: 0,
        proteinTotal: 0,
        label: 'No data',
        coveragePercent: 0,
        groups: {
          leucine: 0,
          lysine: 0,
          valineIsoleucine: 0,
          rest: 0
        },
        targetByCurrentTotal: {
          leucine: 0,
          lysine: 0,
          valineIsoleucine: 0,
          rest: 0
        }
      };
    }

    const analysis = analyzeEaaRatio([
      {
        proteinGrams: Number(selectedFood.protein) || 0,
        amountConsumed: Number(quantity) || 0,
        micros: selectedFood.micros
      }
    ]);

    const percent = analysis.eaaAsProteinPercent;
    const label = percent >= 35 ? 'Excellent' : percent >= 25 ? 'Good' : percent > 0 ? 'Fair' : 'No data';

    return {
      eaaPercent: percent,
      eaaTotal: analysis.eaaTotal,
      proteinTotal: analysis.proteinTotal,
      label,
      coveragePercent: analysis.proteinTotal > 0 ? (analysis.proteinWithEaaData / analysis.proteinTotal) * 100 : 0,
      groups: analysis.groups,
      targetByCurrentTotal: analysis.targetByCurrentTotal
    };
  }, [selectedFood, quantity]);

  const eaaGroupDetails = useMemo(
    () => [
      {
        key: 'leucine',
        label: 'Leucine',
        value: selectedFoodEaaQuality.groups.leucine,
        target: selectedFoodEaaQuality.targetByCurrentTotal.leucine
      },
      {
        key: 'lysine',
        label: 'Lysine',
        value: selectedFoodEaaQuality.groups.lysine,
        target: selectedFoodEaaQuality.targetByCurrentTotal.lysine
      },
      {
        key: 'valineIsoleucine',
        label: 'Valine + Isoleucine',
        value: selectedFoodEaaQuality.groups.valineIsoleucine,
        target: selectedFoodEaaQuality.targetByCurrentTotal.valineIsoleucine
      },
      {
        key: 'rest',
        label: 'Other EAAs',
        value: selectedFoodEaaQuality.groups.rest,
        target: selectedFoodEaaQuality.targetByCurrentTotal.rest
      }
    ],
    [selectedFoodEaaQuality]
  );

  const selectedFoodMicros = useMemo(() => {
    if (!selectedFood?.micros) return [] as Array<{ key: string; label: string; unit: string; value: number }>;

    const normalizedSource = Object.entries(selectedFood.micros).reduce<Record<string, number>>((acc, [key, value]) => {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount <= 0) return acc;
      const normalized = normalizeMicroKey(key);
      acc[normalized] = (acc[normalized] || 0) + amount;
      return acc;
    }, {});

    return MICRONUTRIENT_META
      .map((nutrient) => {
        const aliases = [nutrient.key, ...nutrient.aliases].map(normalizeMicroKey);
        const baseValue = aliases.reduce((sum, alias) => sum + (normalizedSource[alias] || 0), 0);
        const value = baseValue * quantity;
        return {
          key: nutrient.key,
          label: nutrient.label,
          unit: nutrient.unit,
          value
        };
      })
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [selectedFood, quantity]);

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

  const toggleFoodInMeal = async (food: Food) => {
    try {
      const existingIds = mealLogIdsByFood.get(food.id) || [];
      const mostRecentLogId = existingIds[0];

      if (mostRecentLogId) {
        await db.logs.delete(mostRecentLogId);
        setAddedFoodIds((ids) => ids.filter((id) => id !== food.id));
        setAddedCount((count) => Math.max(0, count - 1));
        return;
      }

      await db.logs.add({
        id: generateId(),
        user_id: 'local-user',
        date,
        meal_type: mealType,
        food_id: food.id,
        amount_consumed: 1,
        synced: 0,
        created_at: new Date()
      });

      setAddedCount((count) => count + 1);
      setAddedFoodIds((ids) => (ids.includes(food.id) ? ids : [...ids, food.id]));
    } catch (error) {
      console.error('Failed to toggle quick meal item:', error);
      alert('Failed to update meal item');
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
          <div className="mb-4 flex flex-wrap gap-2">
            <SortChip active={sortOption === 'recent'} onClick={() => setSortOption('recent')}>
              Recently Added
            </SortChip>
            <SortChip active={sortOption === 'frequent'} onClick={() => setSortOption('frequent')}>
              Frequently Used
            </SortChip>
            <SortChip active={sortOption === 'protein'} onClick={() => setSortOption('protein')}>
              Protein Rich
            </SortChip>
          </div>
          <div className="space-y-2">
            {rankedSearchResults && rankedSearchResults.length > 0 ? rankedSearchResults.map((food) => {
              const alreadyAdded = mealLogIdsByFood.has(food.id) || addedFoodIds.includes(food.id);
              const warnings = foodWarningsById[food.id] || [];

              return (
                <div
                  key={food.id}
                  onClick={() => handleSelectFood(food)}
                  className="w-full text-left p-4 bg-card border border-border-subtle rounded-lg shadow-sm hover:bg-surface transition-colors flex justify-between items-center cursor-pointer"
                >
                  <div>
                    <div className="font-bold text-lg text-text-main">{food.name}</div>
                    <div className="text-sm text-text-muted">
                      {food.brand ? `${food.brand} • ` : ''}{food.calories} cal / {formatServingLabel(food)}
                    </div>
                    <MacroContributionBar
                      protein={food.protein}
                      carbs={food.carbs}
                      fat={food.fat}
                    />
                    {warnings.length > 0 && (
                      <div className="text-[11px] text-text-main mt-1">
                        ⚠ {warnings[0]}
                        {warnings.length > 1 ? ` +${warnings.length - 1} more` : ''}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleFoodInMeal(food);
                    }}
                    className={`w-8 h-8 rounded-full text-2xl flex items-center justify-center ${alreadyAdded ? 'bg-green-500 text-white text-lg font-black' : 'bg-brand text-brand-fg'}`}
                    aria-label={alreadyAdded ? `Remove ${food.name} from meal` : `Add ${food.name} to meal`}
                    title={alreadyAdded ? 'Remove from meal' : 'Add to meal'}
                  >
                    {alreadyAdded ? '−' : '+'}
                  </button>
                </div>
              );
            }) : searchQuery.trim().length > 0 ? (
              <div className="text-center text-text-muted mt-8">
                <p className="italic">No foods found for "{searchQuery.trim()}".</p>
                <Link
                  to={`/foods/new?name=${encodeURIComponent(searchQuery.trim())}`}
                  className="inline-block mt-3 px-4 py-2 rounded-lg bg-brand text-brand-fg font-semibold hover:opacity-90 transition-opacity"
                >
                  Create Food
                </Link>
              </div>
            ) : (
              <div className="text-center text-text-muted mt-8 italic">Start typing to search...</div>
            )}
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

          {selectedFoodWarnings.length > 0 && (
            <div className="mb-4 bg-surface border border-border-subtle rounded-lg p-3">
              <p className="text-xs font-bold text-text-main mb-1">Dietary conflict warning</p>
              <ul className="text-xs text-text-main space-y-1">
                {selectedFoodWarnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}

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

          <div className="mt-4 mb-3 bg-surface border border-border-subtle rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-bold text-text-main">EAA Group Breakdown</p>
              <span className="text-[11px] text-text-muted">consumed / target</span>
            </div>
            <div className="bg-card border border-border-subtle rounded-lg p-2.5 mb-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-text-main">EAA Quality</p>
                <span className="text-[11px] font-bold text-brand bg-surface border border-border-subtle px-2 py-0.5 rounded-full">
                  {selectedFoodEaaQuality.label}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-text-main">
                {selectedFoodEaaQuality.eaaPercent > 0
                  ? `${formatNutrientValue(selectedFoodEaaQuality.eaaPercent)}% EAA-to-protein`
                  : 'No amino data'}
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                {formatNutrientValue(selectedFoodEaaQuality.eaaTotal)}g EAA / {formatNutrientValue(selectedFoodEaaQuality.proteinTotal)}g protein
              </p>
              <p className="text-[11px] text-text-muted">
                Coverage {formatNutrientValue(selectedFoodEaaQuality.coveragePercent)}%
              </p>
            </div>
            <div className="space-y-1.5">
              {eaaGroupDetails.map((item) => (
                <div key={item.key} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-text-muted">{item.label}</span>
                    <span className="font-semibold text-text-main">
                      {formatNutrientValue(item.value)}g / {formatNutrientValue(item.target)}g
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-3 bg-surface border border-border-subtle rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-bold text-text-main">EAA Guidance</p>
              <span className="text-[11px] text-text-muted">{eaaDeficitTargeting.summaryLabel}</span>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <p className="text-text-muted">Targeted today</p>
                <p className="font-semibold text-text-main">{eaaGuidance.targetedDeficitsText}</p>
              </div>
              <div>
                <p className="text-text-muted">How this food helps</p>
                <p className="font-semibold text-text-main">{eaaGuidance.helpsText}</p>
              </div>
              <div>
                <p className="text-text-muted">Replace?</p>
                <p className="font-semibold text-text-main">{eaaGuidance.replacementText}</p>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border-subtle rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-bold text-text-main">Micronutrient Breakdown</p>
              <span className="text-[11px] text-text-muted">per selected amount</span>
            </div>
            {selectedFoodMicros.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-auto pr-1">
                {selectedFoodMicros.map((item) => (
                  <div key={item.key} className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">{item.label}</span>
                    <span className="font-semibold text-text-main">
                      {formatNutrientValue(item.value)} {item.unit}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">No micronutrient data available for this food.</p>
            )}
          </div>
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

const SortChip = ({ active, onClick, children }: any) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-brand text-brand-fg' : 'bg-surface text-text-muted border border-border-subtle hover:text-text-main'}`}
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