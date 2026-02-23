import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type GeminiAction = 'nutrition_profile' | 'recipe_ingredients' | 'daily_coach';

const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MINUTES = 60;
const DEFAULT_RATE_LIMIT_RETENTION_DAYS = 7;

function json(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getRateLimitSettings() {
  const maxRequests = parsePositiveIntEnv('AI_RATE_LIMIT_MAX_REQUESTS', DEFAULT_RATE_LIMIT_MAX_REQUESTS);
  const windowMinutes = parsePositiveIntEnv('AI_RATE_LIMIT_WINDOW_MINUTES', DEFAULT_RATE_LIMIT_WINDOW_MINUTES);
  const retentionDays = parsePositiveIntEnv('AI_RATE_LIMIT_RETENTION_DAYS', DEFAULT_RATE_LIMIT_RETENTION_DAYS);
  return {
    maxRequests,
    windowMinutes,
    retentionDays,
    windowMs: windowMinutes * 60 * 1000,
    retentionMs: retentionDays * 24 * 60 * 60 * 1000
  };
}

async function enforceRateLimit(input: {
  adminClient: ReturnType<typeof createClient>;
  userId: string;
  action: GeminiAction;
  now: Date;
}) {
  const settings = getRateLimitSettings();
  const retentionCutoff = new Date(input.now.getTime() - settings.retentionMs).toISOString();
  const { error: retentionError } = await input.adminClient
    .from('ai_gemini_request_logs')
    .delete()
    .eq('user_id', input.userId)
    .eq('action', input.action)
    .lt('created_at', retentionCutoff);

  if (retentionError) throw retentionError;

  const windowStart = new Date(input.now.getTime() - settings.windowMs).toISOString();

  const { count, error: countError } = await input.adminClient
    .from('ai_gemini_request_logs')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', input.userId)
    .eq('action', input.action)
    .gte('created_at', windowStart);

  if (countError) throw countError;

  const currentCount = count ?? 0;
  if (currentCount >= settings.maxRequests) {
    const { data: oldestRows, error: oldestError } = await input.adminClient
      .from('ai_gemini_request_logs')
      .select('created_at')
      .eq('user_id', input.userId)
      .eq('action', input.action)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(1);

    if (oldestError) throw oldestError;

    const oldestTs = oldestRows?.[0]?.created_at ? new Date(oldestRows[0].created_at).getTime() : input.now.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + settings.windowMs - input.now.getTime()) / 1000));

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      limit: settings.maxRequests,
      windowMinutes: settings.windowMinutes
    };
  }

  const { error: insertError } = await input.adminClient
    .from('ai_gemini_request_logs')
    .insert({ user_id: input.userId, action: input.action, created_at: input.now.toISOString() });

  if (insertError) throw insertError;

  return {
    allowed: true,
    remaining: Math.max(0, settings.maxRequests - (currentCount + 1)),
    retryAfterSeconds: 0,
    limit: settings.maxRequests,
    windowMinutes: settings.windowMinutes
  };
}

function parseAiJsonFromText(rawValue: string): Record<string, unknown> | null {
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
}

function isGeminiAction(value: unknown): value is GeminiAction {
  return value === 'nutrition_profile' || value === 'recipe_ingredients' || value === 'daily_coach';
}

function buildDailyCoachPrompt(input: {
  date: string;
  caloriesGoal: number;
  caloriesConsumed: number;
  proteinGoal: number;
  proteinConsumed: number;
  carbsGoal: number;
  carbsConsumed: number;
  fatGoal: number;
  fatConsumed: number;
  waterGoal: number;
  waterToday: number;
  sleepGoal: number;
  sleepToday: number;
  workoutsToday: number;
  workoutMinutesWeek: number;
  todayLogsCount: number;
  dietTags: string[];
  allergies: string[];
  mealPattern: string;
  goalFocus: string;
  activityLevel: string;
  medicalConstraints: string[];
  daySummary: string;
  coachStyle: string;
  timeOfDay: string;
  expectedProgressPercent: number;
  actualProgressPercent: number;
  caloriePacingDelta: number;
  macroPacingDelta: {
    protein: number;
    carbs: number;
    fat: number;
  };
  fiber: {
    goal: number;
    consumed: number;
    remaining: number;
  };
  eaaCoveragePercent: number;
  topEaaDeficits: Array<{ group: string; deficit: number }>;
  topMicronutrientDeficits: Array<{ nutrient: string; deficit: number }>;
  mealTiming: {
    score: number;
    summary: string;
    advice: string;
  };
  weightTrend7d: {
    deltaKg: number;
    distanceToGoalKg: number | null;
    progressPercent: number | null;
  };
}): string {
  return `You are a practical nutrition and recovery coach.
Generate one concise daily suggestion for the user based on this context:
${JSON.stringify(input)}

Return ONLY raw JSON with exact keys:
{
  "suggestion_title": "string",
  "suggestion_text": "string",
  "warning_text": "string",
  "food_or_recipe": "string",
  "why": ["string", "string", "string"]
}

Rules:
- Keep each text short and actionable.
- warning_text can be empty string when no warning is needed.
- food_or_recipe must respect dietTags/allergies.
- Prioritize context in this order: safety constraints, timeOfDay pacing, biggest nutrition deficit, then habit consistency.
- Use expectedProgressPercent vs actualProgressPercent so guidance fits morning/midday/evening.
- If daySummary indicates low motivation/stress, keep advice simpler and lower-friction.
- Respect coachStyle: strict = direct/firm, gentle = supportive/encouraging.
- why must include 2-3 short bullets derived from provided numbers.
- No markdown, no prose outside JSON, no extra keys.`;
}

function buildNutritionPrompt(input: { name: string; servingSize: number; servingUnit: string }): string {
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

  const allowedDietTags = [
    'veg',
    'non_veg',
    'contains_egg',
    'vegan',
    'contains_dairy',
    'contains_onion_garlic',
    'contains_root_vegetables'
  ];

  const allowedAllergenTags = ['milk', 'soy', 'egg', 'peanut', 'tree_nut', 'wheat_gluten', 'sesame', 'shellfish'];

  return `Act as a clinical nutrition database. Provide the full nutritional profile for "${input.name}" specifically for a serving size of ${input.servingSize}${input.servingUnit}.
Return data ONLY as raw JSON with keys: "protein", "fat", "carbs", "calories", "micros", "diet_tags", "allergen_tags", "ai_notes".

EXACT_MICROS_KEYS:
${EXACT_MICROS_KEYS_TEXT}

MICROS_UNIT_CONTRACT:
${MICROS_UNIT_CONTRACT_TEXT}

FOOD_DIET_TAG_ALLOWED_VALUES:
${allowedDietTags.join(', ')}

FOOD_ALLERGEN_TAG_ALLOWED_VALUES:
${allowedAllergenTags.join(', ')}

ai_notes should be 1-2 short lines to help manual review (ingredient assumptions and uncertainty).

Do not include units in keys or values.
If any nutrient is not available, set value to 0.
Arrays must contain only allowed values.
All numeric values must be numbers (no strings, no units, no markdown, no prose, no extra keys).`;
}

function buildRecipeIngredientsPrompt(input: { recipeName: string }): string {
  return `Generate a clean recipe ingredient list for "${input.recipeName}".
Return ONLY raw JSON object with this exact shape:
{
  "recipe_name": "string",
  "ingredients": [
    { "name": "string", "amount": number, "unit": "string" }
  ]
}

Rules:
- Keep ingredient names generic and short.
- amount must be numeric and > 0.
- unit should be practical (g, ml, tsp, tbsp, cup, piece, serving).
- No markdown, no prose, no extra keys.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { ok: false, message: 'Method not allowed' });
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (!jwt) {
      return json(401, { ok: false, message: 'Missing auth token. Please sign in.' });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`
        }
      }
    });

    const {
      data: { user },
      error: userError
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return json(401, { ok: false, message: 'Invalid auth session' });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (!isGeminiAction(action)) {
      return json(400, { ok: false, message: 'Invalid action' });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const now = new Date();
    const rateLimit = await enforceRateLimit({
      adminClient,
      userId: user.id,
      action,
      now
    });

    if (!rateLimit.allowed) {
      return json(
        429,
        {
          ok: false,
          message: `Rate limit exceeded: max ${rateLimit.limit} ${action} requests per ${rateLimit.windowMinutes} minute(s). Try again later.`,
          rate_limit: {
            limit: rateLimit.limit,
            remaining: 0,
            window_minutes: rateLimit.windowMinutes,
            retry_after_seconds: rateLimit.retryAfterSeconds
          }
        },
        {
          'Retry-After': String(rateLimit.retryAfterSeconds),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Window-Minutes': String(rateLimit.windowMinutes)
        }
      );
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')?.trim();
    if (!geminiApiKey) {
      return json(503, {
        ok: false,
        message: 'AI service is temporarily unavailable. Please try again later.'
      });
    }
    const geminiModel = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      generationConfig: { responseMimeType: 'application/json' }
    });

    if (action === 'nutrition_profile') {
      const name = String(body?.name || '').trim();
      const servingSize = Number(body?.servingSize);
      const servingUnit = String(body?.servingUnit || '').trim().toLowerCase();

      if (!name) return json(400, { ok: false, message: 'Missing name' });
      if (!Number.isFinite(servingSize) || servingSize <= 0) return json(400, { ok: false, message: 'Invalid servingSize' });
      if (!servingUnit) return json(400, { ok: false, message: 'Missing servingUnit' });

      const prompt = buildNutritionPrompt({ name, servingSize, servingUnit });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const parsed = parseAiJsonFromText(response.text());

      if (!parsed) {
        return json(502, { ok: false, message: 'Gemini returned invalid JSON payload' });
      }

      return json(200, {
        ok: true,
        action,
        data: parsed,
        rate_limit: {
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
          window_minutes: rateLimit.windowMinutes,
          retry_after_seconds: 0
        }
      }, {
        'X-RateLimit-Limit': String(rateLimit.limit),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Window-Minutes': String(rateLimit.windowMinutes)
      });
    }

    if (action === 'daily_coach') {
      const date = String(body?.date || '').trim();
      if (!date) {
        return json(400, { ok: false, message: 'Missing date' });
      }

      const toFiniteNumber = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const toStringArray = (value: unknown) =>
        Array.isArray(value) ? value.map((item: unknown) => String(item)).filter(Boolean) : [];

      const toTopEaaDeficits = (value: unknown) =>
        Array.isArray(value)
          ? value
              .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const row = entry as { group?: unknown; deficit?: unknown };
                return {
                  group: String(row.group || '').trim(),
                  deficit: toFiniteNumber(row.deficit)
                };
              })
              .filter((entry): entry is { group: string; deficit: number } => Boolean(entry && entry.group))
          : [];

      const toTopMicronutrientDeficits = (value: unknown) =>
        Array.isArray(value)
          ? value
              .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const row = entry as { nutrient?: unknown; deficit?: unknown };
                return {
                  nutrient: String(row.nutrient || '').trim(),
                  deficit: toFiniteNumber(row.deficit)
                };
              })
              .filter((entry): entry is { nutrient: string; deficit: number } => Boolean(entry && entry.nutrient))
          : [];

      const prompt = buildDailyCoachPrompt({
        date,
        caloriesGoal: toFiniteNumber(body?.caloriesGoal),
        caloriesConsumed: toFiniteNumber(body?.caloriesConsumed),
        proteinGoal: toFiniteNumber(body?.proteinGoal),
        proteinConsumed: toFiniteNumber(body?.proteinConsumed),
        carbsGoal: toFiniteNumber(body?.carbsGoal),
        carbsConsumed: toFiniteNumber(body?.carbsConsumed),
        fatGoal: toFiniteNumber(body?.fatGoal),
        fatConsumed: toFiniteNumber(body?.fatConsumed),
        waterGoal: toFiniteNumber(body?.waterGoal),
        waterToday: toFiniteNumber(body?.waterToday),
        sleepGoal: toFiniteNumber(body?.sleepGoal),
        sleepToday: toFiniteNumber(body?.sleepToday),
        workoutsToday: toFiniteNumber(body?.workoutsToday),
        workoutMinutesWeek: toFiniteNumber(body?.workoutMinutesWeek),
        todayLogsCount: toFiniteNumber(body?.todayLogsCount),
        dietTags: toStringArray(body?.dietTags),
        allergies: toStringArray(body?.allergies),
        mealPattern: String(body?.mealPattern || '').trim(),
        goalFocus: String(body?.goalFocus || '').trim(),
        activityLevel: String(body?.activityLevel || '').trim(),
        medicalConstraints: toStringArray(body?.medicalConstraints),
        daySummary: String(body?.daySummary || '').trim(),
        coachStyle: String(body?.coachStyle || 'gentle').trim(),
        timeOfDay: String(body?.timeOfDay || '').trim(),
        expectedProgressPercent: toFiniteNumber(body?.expectedProgressPercent),
        actualProgressPercent: toFiniteNumber(body?.actualProgressPercent),
        caloriePacingDelta: toFiniteNumber(body?.caloriePacingDelta),
        macroPacingDelta: {
          protein: toFiniteNumber((body?.macroPacingDelta as { protein?: unknown } | undefined)?.protein),
          carbs: toFiniteNumber((body?.macroPacingDelta as { carbs?: unknown } | undefined)?.carbs),
          fat: toFiniteNumber((body?.macroPacingDelta as { fat?: unknown } | undefined)?.fat)
        },
        fiber: {
          goal: toFiniteNumber((body?.fiber as { goal?: unknown } | undefined)?.goal),
          consumed: toFiniteNumber((body?.fiber as { consumed?: unknown } | undefined)?.consumed),
          remaining: toFiniteNumber((body?.fiber as { remaining?: unknown } | undefined)?.remaining)
        },
        eaaCoveragePercent: toFiniteNumber(body?.eaaCoveragePercent),
        topEaaDeficits: toTopEaaDeficits(body?.topEaaDeficits).slice(0, 2),
        topMicronutrientDeficits: toTopMicronutrientDeficits(body?.topMicronutrientDeficits).slice(0, 5),
        mealTiming: {
          score: toFiniteNumber((body?.mealTiming as { score?: unknown } | undefined)?.score),
          summary: String((body?.mealTiming as { summary?: unknown } | undefined)?.summary || '').trim(),
          advice: String((body?.mealTiming as { advice?: unknown } | undefined)?.advice || '').trim()
        },
        weightTrend7d: {
          deltaKg: toFiniteNumber((body?.weightTrend7d as { deltaKg?: unknown } | undefined)?.deltaKg),
          distanceToGoalKg: (() => {
            const raw = (body?.weightTrend7d as { distanceToGoalKg?: unknown } | undefined)?.distanceToGoalKg;
            if (raw === null || raw === undefined || raw === '') return null;
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : null;
          })(),
          progressPercent: (() => {
            const raw = (body?.weightTrend7d as { progressPercent?: unknown } | undefined)?.progressPercent;
            if (raw === null || raw === undefined || raw === '') return null;
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : null;
          })()
        }
      });

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const parsed = parseAiJsonFromText(response.text());

      if (!parsed) {
        return json(502, { ok: false, message: 'Gemini returned invalid JSON payload' });
      }

      return json(200, {
        ok: true,
        action,
        data: parsed,
        rate_limit: {
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
          window_minutes: rateLimit.windowMinutes,
          retry_after_seconds: 0
        }
      }, {
        'X-RateLimit-Limit': String(rateLimit.limit),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Window-Minutes': String(rateLimit.windowMinutes)
      });
    }

    const recipeName = String(body?.recipeName || '').trim();
    if (!recipeName) {
      return json(400, { ok: false, message: 'Missing recipeName' });
    }

    const prompt = buildRecipeIngredientsPrompt({ recipeName });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const parsed = parseAiJsonFromText(response.text());

    if (!parsed) {
      return json(502, { ok: false, message: 'Gemini returned invalid JSON payload' });
    }

    return json(200, {
      ok: true,
      action,
      data: parsed,
      rate_limit: {
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        window_minutes: rateLimit.windowMinutes,
        retry_after_seconds: 0
      }
    }, {
      'X-RateLimit-Limit': String(rateLimit.limit),
      'X-RateLimit-Remaining': String(rateLimit.remaining),
      'X-RateLimit-Window-Minutes': String(rateLimit.windowMinutes)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    return json(500, { ok: false, message });
  }
});
