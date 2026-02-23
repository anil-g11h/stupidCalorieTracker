import { supabase } from './supabaseClient';

export interface GeminiNutritionPayload {
  protein?: number;
  fat?: number;
  carbs?: number;
  calories?: number;
  micros?: Record<string, unknown>;
  diet_tags?: unknown;
  allergen_tags?: unknown;
  ai_notes?: unknown;
}

export interface GeminiRecipeIngredientsPayload {
  recipe_name?: string;
  ingredients?: Array<{
    name?: unknown;
    amount?: unknown;
    unit?: unknown;
  }>;
}

interface GeminiFunctionResponse<T> {
  ok?: boolean;
  message?: string;
  data?: T;
}

const AUTH_REQUIRED_MESSAGE = 'Sign in to use AI features.';

async function resolveFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : String(error ?? 'Edge function request failed');

  if (!error || typeof error !== 'object' || !('context' in error)) {
    return fallback;
  }

  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) {
    return fallback;
  }

  try {
    const payload = await context.clone().json();
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const message = String((payload as { message?: unknown }).message || '').trim();
      if (message) return message;
    }
  } catch {
    // Ignore parse failure and fall back to default message
  }

  return fallback;
}

async function invokeGeminiFunction<T>(payload: Record<string, unknown>): Promise<T> {
  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message || AUTH_REQUIRED_MESSAGE);
  }

  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error(AUTH_REQUIRED_MESSAGE);
  }

  const { data, error } = await supabase.functions.invoke('gemini-food-nutrition', {
    body: payload,
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (error) {
    throw new Error(await resolveFunctionErrorMessage(error));
  }

  const response = (data ?? {}) as GeminiFunctionResponse<T>;
  if (!response.ok) {
    throw new Error(response.message || 'Gemini edge function request failed');
  }

  if (!response.data) {
    throw new Error('Gemini edge function returned empty payload');
  }

  return response.data;
}

export async function fetchGeminiNutritionProfile(input: {
  name: string;
  servingSize: number;
  servingUnit: string;
}): Promise<GeminiNutritionPayload> {
  return invokeGeminiFunction<GeminiNutritionPayload>({
    action: 'nutrition_profile',
    name: input.name,
    servingSize: input.servingSize,
    servingUnit: input.servingUnit
  });
}

export async function fetchGeminiRecipeIngredients(input: {
  recipeName: string;
}): Promise<GeminiRecipeIngredientsPayload> {
  return invokeGeminiFunction<GeminiRecipeIngredientsPayload>({
    action: 'recipe_ingredients',
    recipeName: input.recipeName
  });
}
