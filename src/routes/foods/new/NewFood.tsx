import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom'; // Assuming React Router
import { db } from '../../../lib/db';
import { ESSENTIAL_AMINO_ACIDS } from '../../../lib/constants';
import { generateId } from '../../../lib';
import { useStackNavigation } from '../../../lib/useStackNavigation';
import { GoogleGenerativeAI } from "@google/generative-ai";



const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
const geminiModel = 'gemini-2.5-flash';

const ESSENTIAL_VITAMIN_KEYS = [
  'Vitamin A',
  'Vitamin C',
  'Vitamin D',
  'Vitamin E',
  'Vitamin B12',
  'Vitamin B6',
  'Folate (B9)'
] as const;

const ESSENTIAL_MINERAL_KEYS = [
  'Calcium',
  'Magnesium',
  'Potassium',
  'Zinc',
  'Iron',
  'Sodium',
  'Iodine'
] as const;

const ESSENTIAL_VITAMIN_UNITS: Record<(typeof ESSENTIAL_VITAMIN_KEYS)[number], string> = {
  'Vitamin A': 'mcg',
  'Vitamin C': 'mg',
  'Vitamin D': 'mcg',
  'Vitamin E': 'mg',
  'Vitamin B12': 'mcg',
  'Vitamin B6': 'mg',
  'Folate (B9)': 'mcg'
};

const ESSENTIAL_MINERAL_UNITS: Record<(typeof ESSENTIAL_MINERAL_KEYS)[number], string> = {
  Calcium: 'mg',
  Magnesium: 'mg',
  Potassium: 'mg',
  Zinc: 'mg',
  Iron: 'mg',
  Sodium: 'mg',
  Iodine: 'mcg'
};

const REQUIRED_MICRO_KEYS = [
  ...ESSENTIAL_AMINO_ACIDS,
  ...ESSENTIAL_VITAMIN_KEYS,
  ...ESSENTIAL_MINERAL_KEYS
] as const;

const EXACT_MICROS_KEYS_TEXT = [
  'Histidine, Isoleucine, Leucine, Lysine, Methionine, Phenylalanine, Threonine, Tryptophan, Valine,',
  'Vitamin A, Vitamin C, Vitamin D, Vitamin E, Vitamin B12, Vitamin B6, Folate (B9),',
  'Calcium, Magnesium, Potassium, Zinc, Iron, Sodium, Iodine.'
].join('\n');

const MICROS_UNIT_CONTRACT_TEXT = [
  '- Amino acids: grams (g)',
  '- Vitamin A, Vitamin D, Vitamin B12, Folate (B9), Iodine: micrograms (mcg)',
  '- Vitamin C, Vitamin E, Vitamin B6, Calcium, Magnesium, Potassium, Zinc, Iron, Sodium: milligrams (mg)'
].join('\n');

const FOOD_DIET_TAG_OPTIONS = [
  { id: 'veg', label: 'Vegetarian' },
  { id: 'non_veg', label: 'Non-Veg' },
  { id: 'contains_egg', label: 'Contains Egg' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'contains_dairy', label: 'Contains Dairy' },
  { id: 'contains_onion_garlic', label: 'Contains Onion/Garlic' },
  { id: 'contains_root_vegetables', label: 'Contains Root Veg' }
] as const;

const FOOD_ALLERGEN_OPTIONS = [
  { id: 'milk', label: 'Milk / Dairy' },
  { id: 'soy', label: 'Soy' },
  { id: 'egg', label: 'Egg' },
  { id: 'peanut', label: 'Peanut' },
  { id: 'tree_nut', label: 'Tree Nut' },
  { id: 'wheat_gluten', label: 'Wheat / Gluten' },
  { id: 'sesame', label: 'Sesame' },
  { id: 'shellfish', label: 'Shellfish' }
] as const;

const ALLOWED_FOOD_DIET_TAGS = new Set(FOOD_DIET_TAG_OPTIONS.map((item) => item.id));
const ALLOWED_FOOD_ALLERGEN_TAGS = new Set(FOOD_ALLERGEN_OPTIONS.map((item) => item.id));

const KEY_ALIASES: Record<string, string[]> = {
  'Vitamin A': ['Vitamin A', 'vitamin_a', 'retinol', 'vitamin a rae'],
  'Vitamin C': ['Vitamin C', 'vitamin_c', 'ascorbic acid'],
  'Vitamin D': ['Vitamin D', 'vitamin_d', 'vitamin d3', 'cholecalciferol'],
  'Vitamin E': ['Vitamin E', 'vitamin_e', 'alpha tocopherol', 'tocopherol'],
  'Vitamin B12': ['Vitamin B12', 'vitamin_b12', 'b12', 'cobalamin'],
  'Vitamin B6': ['Vitamin B6', 'vitamin_b6', 'b6', 'pyridoxine'],
  'Folate (B9)': ['Folate (B9)', 'folate', 'vitamin_b9', 'folic acid', 'b9'],
  Calcium: ['Calcium'],
  Magnesium: ['Magnesium'],
  Potassium: ['Potassium'],
  Zinc: ['Zinc'],
  Iron: ['Iron'],
  Sodium: ['Sodium', 'Na'],
  Iodine: ['Iodine']
};

const normalizeMicroKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(mg|mcg|g|iu)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toNumericValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const direct = Number(value);
    if (Number.isFinite(direct)) return direct;

    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const getMicroValue = (source: Record<string, unknown>, key: string): number => {
  const normalizedEntries = Object.entries(source).reduce<Record<string, unknown>>((acc, [rawKey, rawValue]) => {
    acc[normalizeMicroKey(rawKey)] = rawValue;
    return acc;
  }, {});

  const candidates = KEY_ALIASES[key] ?? [key];
  for (const candidate of candidates) {
    const value = normalizedEntries[normalizeMicroKey(candidate)];
    const numericValue = toNumericValue(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }

  return 0;
};

const parseAiJsonFromText = (rawValue: string): Record<string, any> | null => {
  const jsonMatch = rawValue.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const candidate = jsonMatch[0];

  try {
    return JSON.parse(candidate);
  } catch {
    try {
      const repaired = candidate
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
};

const normalizeTagArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
};

const filterAllowedTags = (values: string[], allowedSet: Set<string>) =>
  values.filter((value) => allowedSet.has(value));

const SERVING_UNIT_OPTIONS = [
  { value: 'g', label: 'Grams (g)', copyLabel: 'gram' },
  { value: 'ml', label: 'Milliliters (ml)', copyLabel: 'ml' },
  { value: 'oz', label: 'Ounces (oz)', copyLabel: 'oz' },
  { value: 'serving', label: 'Serving', copyLabel: 'serving' }
] as const;

const normalizeServingUnit = (rawUnit?: string) => {
  const unit = (rawUnit || '').trim().toLowerCase();
  if (!unit) return 'g';

  if (unit === 'g' || unit === 'gram' || unit === 'grams' || unit === 'gm') return 'g';
  if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') return 'ml';
  if (unit === 'oz' || unit === 'ounce' || unit === 'ounces') return 'oz';
  if (unit === 'serving' || unit === 'servings' || unit === 'piece' || unit === 'pieces' || unit === 'pc') {
    return 'serving';
  }

  return 'g';
};

const UNIT_CONVERSION_FALLBACK_PREFIX = 'Unit conversion fallback ingredients:';

const parseUnitFallbackIngredients = (notes: string): string[] => {
  if (!notes) return [];
  const line = notes
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith(UNIT_CONVERSION_FALLBACK_PREFIX));

  if (!line) return [];
  const raw = line.replace(UNIT_CONVERSION_FALLBACK_PREFIX, '').trim();
  if (!raw) return [];

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

function formatIngredientQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 10) return String(Math.round(value * 10) / 10);
  return String(Math.round(value * 100) / 100);
}

function formatRecipeIngredientAmount(quantity: number, servingSize: number, servingUnit: string): string {
  const safeQuantity = formatIngredientQuantity(quantity);
  if (servingSize === 1) {
    return `${safeQuantity} ${servingUnit}`;
  }

  return `${safeQuantity} × ${formatIngredientQuantity(servingSize)} ${servingUnit}`;
}

function formatRecipeServing(servingSize: number, servingUnit: string): string {
  if (servingSize === 1) return `1 ${servingUnit}`;
  return `${formatIngredientQuantity(servingSize)} ${servingUnit}`;
}

function normalizeRecipeIngredientUnit(rawUnit?: string): string {
  const unit = String(rawUnit || '').trim().toLowerCase();
  if (!unit) return 'serving';

  if (['piece', 'pieces', 'pc', 'count', 'unit', 'units', 'item', 'items', 'large', 'medium', 'small'].includes(unit)) {
    return 'serving';
  }

  return unit;
}


const CreateFood: React.FC = () => {
  const { id: editFoodId } = useParams<{ id?: string }>();
  const isEditMode = Boolean(editFoodId);
  const navigate = useNavigate();
  const {pop} = useStackNavigation();
  // --- State ---
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [servingSize, setServingSize] = useState<number>(100);
  const [servingUnit, setServingUnit] = useState('g');
  
  const [protein, setProtein] = useState<number>(0);
  const [carbs, setCarbs] = useState<number>(0);
  const [fat, setFat] = useState<number>(0);
  const [micros, setMicros] = useState<Record<string, number>>({});
  const [dietTags, setDietTags] = useState<string[]>([]);
  const [allergenTags, setAllergenTags] = useState<string[]>([]);
  const [aiNotes, setAiNotes] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [showAiPasteInput, setShowAiPasteInput] = useState(false);
  const [isRecipeFood, setIsRecipeFood] = useState(false);
  const [recipeIngredients, setRecipeIngredients] = useState<Array<{
    id: string;
    childFoodId: string;
    name: string;
    quantity: number;
    servingSize: number;
    servingUnit: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>>([]);
  const [unitFallbackIngredients, setUnitFallbackIngredients] = useState<string[]>([]);
  const [prepMultiplier, setPrepMultiplier] = useState<number>(1);
  const [isSavingIngredients, setIsSavingIngredients] = useState(false);


  const [isFetching, setIsFetching] = useState(false);
  const hydratedFoodIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editFoodId) return;
    if (hydratedFoodIdRef.current === editFoodId) return;

    let cancelled = false;

    const loadFoodForEdit = async () => {
      try {
        const existingFood = await db.foods.get(editFoodId);
        if (!existingFood) {
          alert('Food not found');
          navigate('/foods');
          return;
        }

        if (cancelled) return;

        setName(existingFood.name || '');
        setBrand(existingFood.brand || '');
        setServingSize(existingFood.serving_size ?? 100);
        setServingUnit(normalizeServingUnit(existingFood.serving_unit));
        setProtein(existingFood.protein || 0);
        setCarbs(existingFood.carbs || 0);
        setFat(existingFood.fat || 0);
        setMicros(existingFood.micros || {});
        setDietTags(existingFood.diet_tags || []);
        setAllergenTags(existingFood.allergen_tags || []);
        setAiNotes(existingFood.ai_notes || '');
        setUnitFallbackIngredients(parseUnitFallbackIngredients(existingFood.ai_notes || ''));
        setIsRecipeFood(Boolean(existingFood.is_recipe));

        if (existingFood.is_recipe && editFoodId) {
          const ingredientRows = await db.food_ingredients.where('parent_food_id').equals(editFoodId).toArray();
          if (ingredientRows.length > 0) {
            const ingredientFoodIds = [...new Set(ingredientRows.map((row) => row.child_food_id))];
            const ingredientFoods = ingredientFoodIds.length > 0
              ? await db.foods.where('id').anyOf(ingredientFoodIds).toArray()
              : [];
            const ingredientFoodById = ingredientFoods.reduce<Record<string, (typeof ingredientFoods)[number]>>((acc, food) => {
              acc[food.id] = food;
              return acc;
            }, {});

            setRecipeIngredients(
              ingredientRows
                .map((row) => {
                  const ingredientFood = ingredientFoodById[row.child_food_id];

                  return {
                    id: row.id,
                    childFoodId: row.child_food_id,
                    name: ingredientFood?.name || 'Unknown Ingredient',
                    quantity: Number(row.quantity) || 0,
                    servingSize: Number(ingredientFood?.serving_size) || 1,
                    servingUnit: normalizeRecipeIngredientUnit(ingredientFood?.serving_unit),
                    calories: Number(ingredientFood?.calories) || 0,
                    protein: Number(ingredientFood?.protein) || 0,
                    carbs: Number(ingredientFood?.carbs) || 0,
                    fat: Number(ingredientFood?.fat) || 0
                  };
                })
                .sort((a, b) => a.name.localeCompare(b.name))
            );
          } else {
            setRecipeIngredients([]);
          }
        } else {
          setRecipeIngredients([]);
        }

        setPrepMultiplier(1);

        hydratedFoodIdRef.current = editFoodId;
      } catch (error) {
        console.error('Failed to load food for edit:', error);
        alert('Failed to load food');
        navigate('/foods');
      }
    };

    loadFoodForEdit();

    return () => {
      cancelled = true;
    };
  }, [editFoodId, navigate]);

  const updateRecipeIngredientQuantity = (ingredientId: string, nextQuantity: number) => {
    setRecipeIngredients((prev) => prev.map((ingredient) => (
      ingredient.id === ingredientId
        ? { ...ingredient, quantity: Math.max(0, Number.isFinite(nextQuantity) ? nextQuantity : 0) }
        : ingredient
    )));
  };

  const saveRecipeIngredients = async () => {
    if (!isEditMode || !editFoodId || !isRecipeFood) return;

    setIsSavingIngredients(true);
    try {
      await db.transaction('rw', db.food_ingredients, db.foods, async () => {
        await Promise.all(
          recipeIngredients.map((ingredient) =>
            db.food_ingredients.update(ingredient.id, {
              quantity: Math.max(0.01, ingredient.quantity),
              synced: 0
            })
          )
        );

        await db.foods.update(editFoodId, {
          updated_at: new Date(),
          synced: 0
        });
      });

      alert('Recipe ingredient quantities updated.');
    } catch (error) {
      console.error('Failed to update recipe ingredients:', error);
      alert('Failed to update recipe ingredient quantities');
    } finally {
      setIsSavingIngredients(false);
    }
  };

  const fetchAiData = async () => {
    if (!name) return alert("Please enter a food name first");
    if (!geminiApiKey) {
      return alert("Missing Gemini API key. Set VITE_GEMINI_API_KEY in your .env file.");
    }
    
    setIsFetching(true);
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ 
        model: geminiModel,
        generationConfig: { responseMimeType: "application/json" }
      });

      const prompt = `Act as a clinical nutrition database. Provide the full nutritional profile for "${name}" specifically for a serving size of ${servingSize}${servingUnit}.
    Return data ONLY as raw JSON with keys: "protein", "fat", "carbs", "calories", "micros", "diet_tags", "allergen_tags", "ai_notes".

    EXACT_MICROS_KEYS:
    ${EXACT_MICROS_KEYS_TEXT}

    MICROS_UNIT_CONTRACT:
    ${MICROS_UNIT_CONTRACT_TEXT}

    FOOD_DIET_TAG_ALLOWED_VALUES:
    ${[...ALLOWED_FOOD_DIET_TAGS].join(', ')}

    FOOD_ALLERGEN_TAG_ALLOWED_VALUES:
    ${[...ALLOWED_FOOD_ALLERGEN_TAGS].join(', ')}

    ai_notes should be 1-2 short lines to help manual review (ingredient assumptions and uncertainty).

    Do not include units in keys or values.
    If any nutrient is not available, set value to 0.
    Arrays must contain only allowed values.
    All numeric values must be numbers (no strings, no units, no markdown, no prose, no extra keys).`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const data = JSON.parse(response.text());

      // Update State
      setProtein(data.protein || 0);
      setCarbs(data.carbs || 0);
      setFat(data.fat || 0);
      
      if (data.micros && typeof data.micros === 'object') {
        const cleanMicros: Record<string, number> = {};
        REQUIRED_MICRO_KEYS.forEach((microKey) => {
          cleanMicros[microKey] = getMicroValue(data.micros, microKey);
        });
        setMicros(cleanMicros);
      }

      setDietTags(filterAllowedTags(normalizeTagArray(data.diet_tags), ALLOWED_FOOD_DIET_TAGS));
      setAllergenTags(filterAllowedTags(normalizeTagArray(data.allergen_tags), ALLOWED_FOOD_ALLERGEN_TAGS));
      setAiNotes(typeof data.ai_notes === 'string' ? data.ai_notes.trim() : '');
    } catch (err) {
      console.error("AI Fetch Error:", err);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found') || message.includes('404')) {
        alert(`Gemini model \"${geminiModel}\" is not available for this API key/version.`);
      } else {
        alert("Failed to fetch nutrition data.");
      }
    } finally {
      setIsFetching(false);
    }
  };



  // --- Logic ---
  const calories = useMemo(() => {
    return Math.round((protein * 4) + (carbs * 4) + (fat * 9));
  }, [protein, carbs, fat]);

  const copyAIPrompt = () => {
    const foodTarget = name || "[INSERT FOOD NAME]";
    const normalizedServingUnit = normalizeServingUnit(servingUnit);
    const copyLabel = SERVING_UNIT_OPTIONS.find((option) => option.value === normalizedServingUnit)?.copyLabel || normalizedServingUnit;
    const prompt = `Act as a clinical nutrition database. Provide the full nutritional profile for "${foodTarget}" specifically for a serving size of ${servingSize}${normalizedServingUnit}.
  Return data ONLY as raw JSON with keys: "protein", "fat", "carbs", "calories", "micros", "diet_tags", "allergen_tags", "ai_notes".

  EXACT_MICROS_KEYS:
  ${EXACT_MICROS_KEYS_TEXT}

  MICROS_UNIT_CONTRACT:
  ${MICROS_UNIT_CONTRACT_TEXT}

  FOOD_DIET_TAG_ALLOWED_VALUES:
  ${[...ALLOWED_FOOD_DIET_TAGS].join(', ')}

  FOOD_ALLERGEN_TAG_ALLOWED_VALUES:
  ${[...ALLOWED_FOOD_ALLERGEN_TAGS].join(', ')}

  ai_notes should be 1-2 short lines to help manual review (ingredient assumptions and uncertainty).

  Do not include units in keys or values.
  If any nutrient is not available, set value to 0.
  Arrays must contain only allowed values.
  All numeric values must be numbers (no strings, no units, no markdown, no prose, no extra keys).`;
    
    navigator.clipboard.writeText(prompt);
    alert(`Prompt for ${servingSize} ${copyLabel} copied!`);
  };

  const handleAiPaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const rawValue = e.target.value;
    setAiInput(rawValue);

    try {
      const data = parseAiJsonFromText(rawValue);
      if (!data) return;

      if (data.protein !== undefined) setProtein(data.protein);
      if (data.carbs !== undefined) setCarbs(data.carbs);
      if (data.fat !== undefined) setFat(data.fat);
      if (data.micros && typeof data.micros === 'object') {
        const cleanMicros: Record<string, number> = {};
        REQUIRED_MICRO_KEYS.forEach((microKey) => {
          cleanMicros[microKey] = getMicroValue(data.micros, microKey);
        });

        Object.entries(data.micros).forEach(([rawKey, rawValue]) => {
          const normalized = normalizeMicroKey(rawKey);
          const mappedKey = REQUIRED_MICRO_KEYS.find(
            (microKey) =>
              normalizeMicroKey(microKey) === normalized ||
              (KEY_ALIASES[microKey] || []).some((alias) => normalizeMicroKey(alias) === normalized)
          );

          if (mappedKey) {
            cleanMicros[mappedKey] = toNumericValue(rawValue);
          }
        });

        setMicros(cleanMicros);
      }

      if (data.diet_tags !== undefined) {
        setDietTags(filterAllowedTags(normalizeTagArray(data.diet_tags), ALLOWED_FOOD_DIET_TAGS));
      }

      if (data.allergen_tags !== undefined) {
        setAllergenTags(filterAllowedTags(normalizeTagArray(data.allergen_tags), ALLOWED_FOOD_ALLERGEN_TAGS));
      }

      if (data.ai_notes !== undefined) {
        setAiNotes(typeof data.ai_notes === 'string' ? data.ai_notes.trim() : '');
      }
    } catch (err) {
      console.error("Parse error", err);
    }
  };

  const toggleDietTag = (tag: string) => {
    setDietTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };

  const toggleAllergenTag = (tag: string) => {
    setAllergenTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };


    async function handleSubmit() {
    try {
      const now = new Date();

      if (isEditMode && editFoodId) {
        const existingFood = await db.foods.get(editFoodId);
        if (!existingFood) {
          alert('Food not found');
          pop('/foods');
          return;
        }

        await db.foods.update(editFoodId, {
          name,
          brand: brand || undefined,
          diet_tags: dietTags,
          allergen_tags: allergenTags,
          ai_notes: aiNotes || undefined,
          calories,
          protein,
          carbs,
          fat,
          serving_size: servingSize,
          serving_unit: servingUnit,
          micros,
          is_recipe: existingFood.is_recipe,
          updated_at: now,
          synced: 0
        });
      } else {
        await db.foods.add({
          id: generateId(),
          name,
          brand: brand || undefined,
          diet_tags: dietTags,
          allergen_tags: allergenTags,
          ai_notes: aiNotes || undefined,
          calories,
          protein,
          carbs,
          fat,
          serving_size: servingSize,
          serving_unit: servingUnit,
          micros,
          is_recipe: false,
          created_at: now,
          updated_at: now,
          synced: 0
        });
      }

      pop('/foods');
    } catch (error) {
      console.error('Failed to save food:', error);
      alert('Failed to save food');
    }
  }

  return (
<div className="container mx-auto p-4 max-w-lg bg-page">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{isEditMode ? 'Edit Food' : 'New Food'}</h1>
        <button 
          onClick={fetchAiData}
          disabled={isFetching || !name}
          className={`flex items-center gap-2 text-xs px-4 py-2 rounded-lg font-bold transition-all ${
            isFetching ? 'bg-gray-400' : 'bg-brand text-brand-fg hover:opacity-90'
          }`}
        >
          {isFetching ? '⌛ Fetching...' : '✨ Magic Fill'}
        </button>
      </header>

      {/* Smart Import Section */}
      <div className="mb-8 p-4 bg-surface rounded-xl border border-border-subtle">
        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
          AI Data Importer
        </label>
        {!showAiPasteInput ? (
          <button
            type="button"
            onClick={() => {
              copyAIPrompt();
              setShowAiPasteInput(true);
            }}
            className="w-full p-3 text-sm font-bold border border-border-subtle rounded-lg bg-card text-text-main hover:bg-brand hover:text-brand-fg hover:border-brand transition-colors"
          >
            Copy Prompt
          </button>
        ) : (
          <textarea
            value={aiInput}
            onChange={handleAiPaste}
            placeholder="Paste AI response here to auto-fill everything..."
            className="w-full h-24 p-2 text-sm border border-border-subtle rounded-lg focus:ring-2 focus:ring-brand focus:outline-none bg-card placeholder:text-text-muted"
          />
        )}
      </div>

      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        {/* Basic Identification */}
        <div className="space-y-3">
          <input 
            placeholder="Food Name (e.g. Greek Yogurt)"
            value={name} 
            onChange={(e) => setName(e.target.value)}
            className="w-full p-3 text-lg font-semibold border-b border-border-subtle focus:border-brand outline-none transition-colors bg-transparent"
          />
          <input 
            placeholder="Brand (Optional)"
            value={brand} 
            onChange={(e) => setBrand(e.target.value)}
            className="w-full p-2 text-sm text-text-muted bg-surface rounded border-none focus:ring-1 focus:ring-brand" 
          />
        </div>

        {/* Serving Size Setup */}
        <div className="flex items-end gap-4 p-4 bg-surface rounded-xl border border-border-subtle">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-text-muted uppercase mb-1 ml-1">Serving Size</label>
            <input 
              type="number"
              value={servingSize}
              onChange={(e) => setServingSize(parseFloat(e.target.value) || 0)}
              className="w-full p-2 border border-border-subtle rounded-lg text-center font-bold bg-card text-text-main"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-text-muted uppercase mb-1 ml-1">Unit</label>
            <select 
              value={servingUnit}
              onChange={(e) => setServingUnit(normalizeServingUnit(e.target.value))}
              className="w-full p-2 border border-border-subtle rounded-lg bg-card font-medium text-text-main"
            >
              {SERVING_UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {isEditMode && isRecipeFood && (
          <div className="space-y-3 p-4 bg-surface rounded-xl border border-border-subtle">
            <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest">Recipe Ingredients</label>
            {unitFallbackIngredients.length > 0 && (
              <div className="text-xs rounded-lg border border-macro-fat/30 bg-macro-fat/10 px-2.5 py-2 text-text-main">
                ⚠ Unit conversion fallback used for: {unitFallbackIngredients.join(', ')}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Prep Multiplier</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={prepMultiplier}
                onChange={(e) => setPrepMultiplier(Math.max(0.1, Number(e.target.value) || 1))}
                className="w-24 p-1.5 text-sm border border-border-subtle rounded-lg text-right bg-card text-text-main"
              />
            </div>
            {recipeIngredients.length === 0 ? (
              <p className="text-xs text-text-muted">No linked ingredients found for this recipe.</p>
            ) : (
              <ul className="space-y-2">
                {recipeIngredients.map((ingredient) => (
                  <li key={ingredient.id} className="text-sm text-text-main rounded-lg border border-border-subtle p-2">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        to={`/foods/${ingredient.childFoodId}/edit`}
                        className="truncate text-brand hover:underline"
                      >
                        {ingredient.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ingredient.quantity}
                          onChange={(e) => updateRecipeIngredientQuantity(ingredient.id, Number(e.target.value))}
                          className="w-20 p-1 text-right text-xs border border-border-subtle rounded bg-card text-text-main"
                        />
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-text-muted">
                      Serving: {formatRecipeServing(ingredient.servingSize, ingredient.servingUnit)}
                      {Math.abs(prepMultiplier - 1) > 0.001 && (
                        <>
                          {' • '}Prep total: {formatRecipeIngredientAmount(ingredient.quantity * prepMultiplier, ingredient.servingSize, ingredient.servingUnit)}
                        </>
                      )}
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] font-bold text-brand">View nutrition</summary>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-text-muted">
                        <span>Base kcal: {formatIngredientQuantity(ingredient.calories * ingredient.quantity)}</span>
                        <span>Base protein: {formatIngredientQuantity(ingredient.protein * ingredient.quantity)} g</span>
                        <span>Base carbs: {formatIngredientQuantity(ingredient.carbs * ingredient.quantity)} g</span>
                        <span>Base fat: {formatIngredientQuantity(ingredient.fat * ingredient.quantity)} g</span>
                        {Math.abs(prepMultiplier - 1) > 0.001 && (
                          <>
                            <span>Prep kcal: {formatIngredientQuantity(ingredient.calories * ingredient.quantity * prepMultiplier)}</span>
                            <span>Prep protein: {formatIngredientQuantity(ingredient.protein * ingredient.quantity * prepMultiplier)} g</span>
                            <span>Prep carbs: {formatIngredientQuantity(ingredient.carbs * ingredient.quantity * prepMultiplier)} g</span>
                            <span>Prep fat: {formatIngredientQuantity(ingredient.fat * ingredient.quantity * prepMultiplier)} g</span>
                          </>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {recipeIngredients.length > 0 && (
              <button
                type="button"
                onClick={saveRecipeIngredients}
                disabled={isSavingIngredients}
                className="w-full py-2 rounded-lg bg-brand text-brand-fg text-sm font-bold disabled:opacity-60"
              >
                {isSavingIngredients ? 'Saving…' : 'Save Ingredient Quantities'}
              </button>
            )}
          </div>
        )}

        <div className="space-y-3 p-4 bg-surface rounded-xl border border-border-subtle">
          <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest">Food Dietary Tags</label>
          <div className="flex flex-wrap gap-2">
            {FOOD_DIET_TAG_OPTIONS.map((option) => {
              const active = dietTags.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleDietTag(option.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                    active
                      ? 'bg-brand text-brand-fg border-brand'
                      : 'bg-card text-text-muted hover:text-text-main border-border-subtle'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 p-4 bg-surface rounded-xl border border-border-subtle">
          <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest">Allergen Tags</label>
          <div className="grid grid-cols-2 gap-2">
            {FOOD_ALLERGEN_OPTIONS.map((option) => (
              <label key={option.id} className="inline-flex items-center gap-2 bg-card border border-border-subtle rounded-lg px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={allergenTags.includes(option.id)}
                  onChange={() => toggleAllergenTag(option.id)}
                  className="h-4 w-4 rounded border-border-subtle bg-surface"
                />
                <span className="text-xs text-text-main">{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest">AI Notes (Auto + Editable)</label>
          <textarea
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="AI can add ingredient assumptions and caution notes here."
            className="w-full min-h-20 p-3 text-sm border border-border-subtle rounded-lg focus:ring-2 focus:ring-brand focus:outline-none bg-card text-text-main"
          />
        </div>

        {/* Macros Grid */}
        <div className="grid grid-cols-4 gap-2">
          <MacroBox label="Prot" color="text-macro-protein" val={protein} set={setProtein} />
          <MacroBox label="Carb" color="text-macro-carbs" val={carbs} set={setCarbs} />
          <MacroBox label="Fat" color="text-macro-fat" val={fat} set={setFat} />
          <div className="flex flex-col items-center justify-center bg-brand text-brand-fg rounded-xl py-2">
            <span className="text-[10px] uppercase opacity-60">Kcal</span>
            <span className="text-lg font-black">{calories}</span>
          </div>
        </div>

        {/* Detailed Micros */}
        <div className="space-y-4">
          <details className="group border border-border-subtle rounded-xl overflow-hidden shadow-sm">
            <summary className="p-4 bg-card cursor-pointer hover:bg-surface flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <span className="text-brand text-lg">🧬</span>
                <span className="font-bold text-sm text-text-main">Essential Amino Acids</span>
              </div>
              <span className="text-text-muted group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface border-t border-border-subtle">
              {ESSENTIAL_AMINO_ACIDS.map((amino) => (
                <div key={amino} className="flex flex-col">
                  <label className="text-[10px] font-bold text-text-muted uppercase mb-1">{amino}</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      value={micros[amino] ?? ''} 
                      onChange={(e) => setMicros(p => ({ ...p, [amino]: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 pr-8 text-sm border border-border-subtle rounded-lg focus:ring-1 focus:ring-brand outline-none bg-card text-text-main" 
                    />
                    <span className="absolute right-2 top-2 text-[10px] text-text-muted">g</span>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="group border border-border-subtle rounded-xl overflow-hidden shadow-sm">
            <summary className="p-4 bg-card cursor-pointer hover:bg-surface flex items-center justify-between select-none">
              <span className="font-bold text-sm text-text-main">Essential Vitamins</span>
              <span className="text-text-muted group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface border-t border-border-subtle">
              {ESSENTIAL_VITAMIN_KEYS.map((vitamin) => (
                <div key={vitamin} className="flex flex-col">
                  <label className="text-[10px] font-bold text-text-muted uppercase mb-1">{vitamin}</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      value={micros[vitamin] ?? ''} 
                      onChange={(e) => setMicros(p => ({ ...p, [vitamin]: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 pr-10 text-sm border border-border-subtle rounded-lg focus:ring-1 focus:ring-brand outline-none bg-card text-text-main" 
                    />
                    <span className="absolute right-2 top-2 text-[10px] text-text-muted">{ESSENTIAL_VITAMIN_UNITS[vitamin]}</span>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="group border border-border-subtle rounded-xl overflow-hidden shadow-sm">
            <summary className="p-4 bg-card cursor-pointer hover:bg-surface flex items-center justify-between select-none">
              <span className="font-bold text-sm text-text-main">Essential Minerals</span>
              <span className="text-text-muted group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface border-t border-border-subtle">
              {ESSENTIAL_MINERAL_KEYS.map((mineral) => (
                <div key={mineral} className="flex flex-col">
                  <label className="text-[10px] font-bold text-text-muted uppercase mb-1">{mineral}</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      value={micros[mineral] ?? ''} 
                      onChange={(e) => setMicros(p => ({ ...p, [mineral]: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 pr-10 text-sm border border-border-subtle rounded-lg focus:ring-1 focus:ring-brand outline-none bg-card text-text-main" 
                    />
                    <span className="absolute right-2 top-2 text-[10px] text-text-muted">{ESSENTIAL_MINERAL_UNITS[mineral]}</span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Link to="/foods" className="flex-1 py-3 text-center font-bold text-text-muted hover:text-text-main transition-colors">Cancel</Link>
          <button 
            onClick={handleSubmit}
            className="flex-[2] py-4 bg-brand text-brand-fg rounded-xl font-black text-lg shadow-lg hover:opacity-90 active:scale-[0.98] transition-all"
          >
            {isEditMode ? 'Update Food' : 'Save Food'}
          </button>
        </div>
      </form>
    </div>
  );
};

// Sub-component for Macro Inputs
const MacroBox = ({ label, color, val, set }: any) => (
  <div className="flex flex-col items-center p-2 bg-card border border-border-subtle rounded-xl shadow-sm">
    <label className={`text-[10px] font-black uppercase mb-1 ${color}`}>{label}</label>
    <input 
      type="number" 
      value={val || ''} 
      onChange={(e) => set(parseFloat(e.target.value) || 0)}
      className="w-full text-center font-bold text-lg outline-none text-text-main bg-transparent"
    />
  </div>
);

export default CreateFood;