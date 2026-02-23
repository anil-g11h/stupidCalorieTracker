import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type GlobalAdminAction =
  | 'cleanup_duplicate_public_workout_exercises'
  | 'cleanup_orphan_food_ingredients';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-maintenance-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isValidAction(value: unknown): value is GlobalAdminAction {
  return (
    value === 'cleanup_duplicate_public_workout_exercises' ||
    value === 'cleanup_orphan_food_ingredients'
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { ok: false, message: 'Method not allowed' });
  }

  return json(410, { ok: false, message: 'Admin maintenance endpoint is disabled.' });

  try {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

    if (!jwt) {
      return json(401, { ok: false, message: 'Missing bearer token' });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const {
      data: { user },
      error: userError
    } = await adminClient.auth.getUser(jwt);

    if (userError || !user) {
      return json(401, {
        ok: false,
        message: `Invalid auth session${userError?.message ? `: ${userError.message}` : ''}`
      });
    }

    const allowedAdminEmails = parseAdminEmails(Deno.env.get('ADMIN_EMAILS'));
    const userEmail = (user.email ?? '').toLowerCase();
    if (!allowedAdminEmails.includes(userEmail)) {
      return json(403, { ok: false, message: 'Forbidden: not an admin user' });
    }

    const expectedToken = Deno.env.get('ADMIN_MAINTENANCE_TOKEN');
    const providedToken = req.headers.get('x-admin-maintenance-token')?.trim() ?? '';
    if (expectedToken && providedToken !== expectedToken) {
      return json(403, { ok: false, message: 'Forbidden: invalid admin token' });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (!isValidAction(action)) {
      return json(400, { ok: false, message: 'Invalid action' });
    }

    if (action === 'cleanup_duplicate_public_workout_exercises') {
      const { data: exercises, error: exercisesError } = await adminClient
        .from('workout_exercises_def')
        .select('id,source_id,updated_at,created_at')
        .is('user_id', null)
        .not('source_id', 'is', null);

      if (exercisesError) {
        return json(500, { ok: false, message: exercisesError.message });
      }

      const grouped = new Map<string, Array<{ id: string; updated_at?: string; created_at?: string }>>();
      for (const item of exercises ?? []) {
        const sourceId = String(item.source_id ?? '').trim();
        if (!sourceId) continue;
        const existing = grouped.get(sourceId) ?? [];
        existing.push({ id: item.id, updated_at: item.updated_at, created_at: item.created_at });
        grouped.set(sourceId, existing);
      }

      const duplicates: Array<{ duplicateId: string; keepId: string }> = [];

      for (const [, items] of grouped) {
        if (items.length < 2) continue;
        const sorted = [...items].sort((a, b) => {
          const aTs = a.updated_at ?? a.created_at ?? '';
          const bTs = b.updated_at ?? b.created_at ?? '';
          if (aTs !== bTs) return aTs < bTs ? 1 : -1;
          return a.id < b.id ? 1 : -1;
        });
        const keepId = sorted[0]?.id;
        if (!keepId) continue;
        for (let i = 1; i < sorted.length; i++) {
          duplicates.push({ duplicateId: sorted[i].id, keepId });
        }
      }

      let updatedWorkoutEntries = 0;
      let updatedRoutineEntries = 0;
      let updatedRestPrefs = 0;
      let deletedExercises = 0;

      for (const item of duplicates) {
        const { error: workoutEntriesError, count: workoutEntriesCount } = await adminClient
          .from('workout_log_entries')
          .update({ exercise_id: item.keepId }, { count: 'exact' })
          .eq('exercise_id', item.duplicateId);
        if (workoutEntriesError) return json(500, { ok: false, message: workoutEntriesError.message });
        updatedWorkoutEntries += workoutEntriesCount ?? 0;

        const { error: routineEntriesError, count: routineEntriesCount } = await adminClient
          .from('workout_routine_entries')
          .update({ exercise_id: item.keepId }, { count: 'exact' })
          .eq('exercise_id', item.duplicateId);
        if (routineEntriesError) return json(500, { ok: false, message: routineEntriesError.message });
        updatedRoutineEntries += routineEntriesCount ?? 0;

        const { error: restPrefsError, count: restPrefsCount } = await adminClient
          .from('workout_rest_preferences')
          .update({ exercise_id: item.keepId }, { count: 'exact' })
          .eq('exercise_id', item.duplicateId);
        if (restPrefsError) return json(500, { ok: false, message: restPrefsError.message });
        updatedRestPrefs += restPrefsCount ?? 0;

        const { error: deleteError, count: deleteCount } = await adminClient
          .from('workout_exercises_def')
          .delete({ count: 'exact' })
          .eq('id', item.duplicateId)
          .is('user_id', null);
        if (deleteError) return json(500, { ok: false, message: deleteError.message });
        deletedExercises += deleteCount ?? 0;
      }

      return json(200, {
        ok: true,
        action,
        summary: {
          duplicatePairs: duplicates.length,
          updatedWorkoutEntries,
          updatedRoutineEntries,
          updatedRestPrefs,
          deletedExercises
        },
        message: `Deduped public workout exercises: removed ${deletedExercises}`
      });
    }

    if (action === 'cleanup_orphan_food_ingredients') {
      const { data: ingredients, error: ingredientsError } = await adminClient
        .from('food_ingredients')
        .select('id,parent_food_id,child_food_id');

      if (ingredientsError) {
        return json(500, { ok: false, message: ingredientsError.message });
      }

      const foodIds = new Set<string>();
      for (const row of ingredients ?? []) {
        if (row.parent_food_id) foodIds.add(row.parent_food_id);
        if (row.child_food_id) foodIds.add(row.child_food_id);
      }

      const foodIdArray = [...foodIds];
      const existingFoodIds = new Set<string>();

      if (foodIdArray.length > 0) {
        const { data: foods, error: foodsError } = await adminClient
          .from('foods')
          .select('id')
          .in('id', foodIdArray);

        if (foodsError) {
          return json(500, { ok: false, message: foodsError.message });
        }

        for (const food of foods ?? []) {
          existingFoodIds.add(food.id);
        }
      }

      const orphanIds = (ingredients ?? [])
        .filter((row) => !existingFoodIds.has(row.parent_food_id) || !existingFoodIds.has(row.child_food_id))
        .map((row) => row.id);

      let removed = 0;
      if (orphanIds.length > 0) {
        const { error: deleteError, count: deleteCount } = await adminClient
          .from('food_ingredients')
          .delete({ count: 'exact' })
          .in('id', orphanIds);

        if (deleteError) {
          return json(500, { ok: false, message: deleteError.message });
        }

        removed = deleteCount ?? 0;
      }

      return json(200, {
        ok: true,
        action,
        summary: {
          scanned: ingredients?.length ?? 0,
          removed
        },
        message: `Removed ${removed} orphan food ingredient rows`
      });
    }

    return json(400, { ok: false, message: 'Unsupported action' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    return json(500, { ok: false, message });
  }
});
