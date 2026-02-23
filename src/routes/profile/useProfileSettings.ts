import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Profile } from '../../lib/db';
import { generateId } from '../../lib';
import {
  buildProfilePatchFromPreferences,
  createDefaultDietaryPreferences,
  normalizeDietaryPreferences,
  type DietaryPreferences
} from '../../lib/dietaryProfile';
import {
  buildMealsFromPattern,
  getFastingWindowHint,
  getMealTimingAdvice,
  getSuggestedMealTime,
  sortMealsForDisplay,
  type MealSetting,
  type MealTargetMode
} from './mealPlanning';
import { supabase } from '../../lib/supabaseClient';
import { syncManager } from '../../lib/sync';

export type ReminderKey = 'food' | 'water' | 'workout' | 'walk' | 'weight' | 'medicine';
export type OpenProfileSection = 'nutrition' | 'dietary' | 'meals' | 'reminders' | null;

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
    proteinTargetGrams?: number;
    carbsTargetGrams?: number;
    fatTargetGrams?: number;
    sleepTarget?: number;
    waterTarget?: number;
    weightTarget?: number;
  };
  meals: MealSetting[];
  reminders: Record<ReminderKey, ReminderSetting>;
  updated_at: string;
}

const SETTINGS_STORAGE_KEY = 'stupid_tracker_settings_v1';
const SETTINGS_ID: LocalSettingsRow['id'] = 'local-settings';
export const REMINDER_KEYS: ReminderKey[] = ['food', 'water', 'workout', 'walk', 'weight', 'medicine'];
const createDefaultSettings = (): LocalSettingsRow => ({
  id: SETTINGS_ID,
  nutrition: {
    calorieBudget: 2000,
    proteinPercent: 30,
    carbPercent: 40,
    fatPercent: 30,
    fiberGrams: 30,
    proteinTargetGrams: 150,
    carbsTargetGrams: 200,
    fatTargetGrams: 65,
    sleepTarget: 8,
    waterTarget: 2000,
    weightTarget: 0
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
      fiberGrams: toNonNegativeNumber(Number(nutrition.fiberGrams), defaults.nutrition.fiberGrams),
      proteinTargetGrams: toNonNegativeNumber(Number(nutrition.proteinTargetGrams), defaults.nutrition.proteinTargetGrams),
      carbsTargetGrams: toNonNegativeNumber(Number(nutrition.carbsTargetGrams), defaults.nutrition.carbsTargetGrams),
      fatTargetGrams: toNonNegativeNumber(Number(nutrition.fatTargetGrams), defaults.nutrition.fatTargetGrams),
      sleepTarget: toNonNegativeNumber(Number(nutrition.sleepTarget), defaults.nutrition.sleepTarget),
      waterTarget: toNonNegativeNumber(Number(nutrition.waterTarget), defaults.nutrition.waterTarget),
      weightTarget: toNonNegativeNumber(Number(nutrition.weightTarget), defaults.nutrition.weightTarget)
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

export function useProfileSettings() {
  const [openSection, setOpenSection] = useState<OpenProfileSection>(null);
  const [mealInputMode, setMealInputMode] = useState<MealTargetMode>('percent');
  const [draggingMacroHandle, setDraggingMacroHandle] = useState<'first' | 'second' | null>(null);
  const macroTrackRef = useRef<HTMLDivElement | null>(null);
  const settingsTable = db.table<LocalSettingsRow, string>('settings');
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<LocalSettingsRow>(createDefaultSettings());
  const [dietaryForm, setDietaryForm] = useState<DietaryPreferences>(createDefaultDietaryPreferences());
  const [customAllergyInput, setCustomAllergyInput] = useState('');

  const settingsRow = useLiveQuery(
    async () => settingsTable.get(SETTINGS_ID),
    [settingsTable],
    undefined as LocalSettingsRow | undefined
  );

  const profileRow = useLiveQuery(
    async () => {
      const userId = session?.user?.id;
      if (!userId) return undefined;
      return db.profiles.get(userId);
    },
    [session?.user?.id],
    undefined as Profile | undefined
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
  }, [settingsTable]);

  useEffect(() => {
    if (!settingsRow) return;

    const normalized = normalizeSettings(settingsRow);
    setForm((prev) => {
      if (
        prev.updated_at === normalized.updated_at &&
        prev.nutrition.calorieBudget === normalized.nutrition.calorieBudget &&
        prev.nutrition.proteinPercent === normalized.nutrition.proteinPercent &&
        prev.nutrition.carbPercent === normalized.nutrition.carbPercent &&
        prev.nutrition.fatPercent === normalized.nutrition.fatPercent
      ) {
        return prev;
      }
      return normalized;
    });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  }, [settingsRow]);

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

  useEffect(() => {
    if (!session?.user?.id) {
      setDietaryForm(createDefaultDietaryPreferences());
      return;
    }

    setDietaryForm(normalizeDietaryPreferences(profileRow));
  }, [profileRow, session?.user?.id]);

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

  const fastingWindowHint = useMemo(
    () => getFastingWindowHint(dietaryForm.mealPattern, form.meals),
    [dietaryForm.mealPattern, form.meals]
  );

  const mealTimingAdvice = useMemo(
    () => getMealTimingAdvice(form.meals, dietaryForm.mealPattern, fastingWindowHint),
    [form.meals, dietaryForm.mealPattern, fastingWindowHint]
  );

  const sortedMeals = useMemo(() => sortMealsForDisplay(form.meals), [form.meals]);

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

    const updateFromClientX = (clientX: number) => {
      if (!macroTrackRef.current) return;
      const rect = macroTrackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;

      const rawPercent = ((clientX - rect.left) / rect.width) * 100;
      const clampedPercent = Math.min(100, Math.max(0, rawPercent));

      if (draggingMacroHandle === 'first') {
        setMacroCuts(clampedPercent, macroSecondCut);
      } else {
        setMacroCuts(macroFirstCut, clampedPercent);
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      updateFromClientX(event.clientX);
    };

    const onPointerMove = (event: PointerEvent) => {
      updateFromClientX(event.clientX);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      updateFromClientX(touch.clientX);
    };

    const onMouseUp = () => setDraggingMacroHandle(null);
    const onPointerUp = () => setDraggingMacroHandle(null);
    const onTouchEnd = () => setDraggingMacroHandle(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [draggingMacroHandle, macroFirstCut, macroSecondCut]);

  const addMeal = () => {
    const nextTime = getSuggestedMealTime(form.meals);
    setForm((prev) => ({
      ...prev,
      meals: [
        ...prev.meals,
        {
          id: generateId(),
          name: `Meal ${prev.meals.length + 1}`,
          time: nextTime,
          targetMode: 'percent',
          targetValue: 20
        }
      ]
    }));
  };

  const onMealPatternSelected = (selectedPattern: string) => {
    const mealsFromPattern = buildMealsFromPattern(selectedPattern, generateId);
    if (mealsFromPattern.length > 0) {
      setForm((prev) => ({ ...prev, meals: mealsFromPattern }));
    }
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

  const toggleDietTag = (tag: string) => {
    setDietaryForm((prev) => {
      const next = prev.dietTags.includes(tag)
        ? prev.dietTags.filter((item) => item !== tag)
        : [...prev.dietTags, tag];
      return { ...prev, dietTags: next };
    });
  };

  const toggleAllergy = (allergy: string) => {
    setDietaryForm((prev) => {
      const next = prev.allergies.includes(allergy)
        ? prev.allergies.filter((item) => item !== allergy)
        : [...prev.allergies, allergy];
      return { ...prev, allergies: next };
    });
  };

  const toggleMedicalConstraint = (constraint: string) => {
    setDietaryForm((prev) => {
      const next = prev.medicalConstraints.includes(constraint)
        ? prev.medicalConstraints.filter((item) => item !== constraint)
        : [...prev.medicalConstraints, constraint];
      return { ...prev, medicalConstraints: next };
    });
  };

  const addCustomAllergy = () => {
    const nextValue = customAllergyInput.trim();
    if (!nextValue) return;

    setDietaryForm((prev) => {
      if (prev.customAllergies.some((item) => item.toLowerCase() === nextValue.toLowerCase())) {
        return prev;
      }

      return {
        ...prev,
        customAllergies: [...prev.customAllergies, nextValue]
      };
    });

    setCustomAllergyInput('');
  };

  const removeCustomAllergy = (value: string) => {
    setDietaryForm((prev) => ({
      ...prev,
      customAllergies: prev.customAllergies.filter((item) => item !== value)
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

      const calories = normalized.nutrition.calorieBudget;
      const proteinGrams = round1((calories * (normalized.nutrition.proteinPercent / 100)) / 4);
      const carbGrams = round1((calories * (normalized.nutrition.carbPercent / 100)) / 4);
      const fatGrams = round1((calories * (normalized.nutrition.fatPercent / 100)) / 9);

      const enriched = normalizeSettings({
        ...normalized,
        nutrition: {
          ...normalized.nutrition,
          proteinTargetGrams: proteinGrams,
          carbsTargetGrams: carbGrams,
          fatTargetGrams: fatGrams
        },
        updated_at: new Date().toISOString()
      });

      await settingsTable.put(enriched);
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(enriched));
      setForm(enriched);

      const userId = session?.user?.id ?? 'local-user';
      const currentProfile = await db.profiles.get(userId);
      const upsertProfile: Profile = {
        id: userId,
        username: currentProfile?.username,
        full_name: currentProfile?.full_name,
        avatar_url: currentProfile?.avatar_url,
        synced: 0,
        ...buildProfilePatchFromPreferences(dietaryForm)
      };

      await db.profiles.put(upsertProfile);
      if (navigator.onLine) {
        await syncManager.sync();
      }
      alert('Settings saved');
    } catch (error) {
      console.error(error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return {
    session,
    loading,
    saving,
    openSection,
    setOpenSection,
    mealInputMode,
    setMealInputMode,
    macroTrackRef,
    draggingMacroHandle,
    setDraggingMacroHandle,
    form,
    dietaryForm,
    setDietaryForm,
    customAllergyInput,
    setCustomAllergyInput,
    macroFirstCut,
    macroSecondCut,
    proteinGramsDisplay,
    carbGramsDisplay,
    fatGramsDisplay,
    dailyCalorieBudget,
    totalMealPercent,
    totalMealCalories,
    canSaveSettings,
    fastingWindowHint,
    mealTimingAdvice,
    sortedMeals,
    updateNutrition,
    addMeal,
    onMealPatternSelected,
    updateMeal,
    removeMeal,
    updateReminder,
    toggleDietTag,
    toggleAllergy,
    toggleMedicalConstraint,
    addCustomAllergy,
    removeCustomAllergy,
    saveAllSettings
  };
}
