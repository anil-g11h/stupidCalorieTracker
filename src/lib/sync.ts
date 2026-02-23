import { db, type SyncQueue, withRemoteSyncWrite } from './db';
import { supabase } from './supabaseClient';
import Dexie from 'dexie';

const SYNC_INTERVAL_MS = 30000; // 30 seconds
const LAST_SYNCED_KEY_BASE = 'stupid_calorie_tracker_last_synced';

interface SyncTableConfig {
    dexie: string;
    supabase: string;
    dateField: string;
    fallbackDateField?: string;
    public?: boolean;
    select?: string;
    reconcileDeletes?: boolean;
}

export class SyncManager {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
    private skippedSharedWorkoutExerciseUpdates = 0;

    async getQueueSummary() {
        const queue = await db.sync_queue.toArray();
        const total = queue.length;
        const failed = queue.filter((item) => (item.attempt_count ?? 0) >= 3).length;
        const pending = total - failed;
        const byTable = queue.reduce<Record<string, number>>((acc, item) => {
            acc[item.table] = (acc[item.table] ?? 0) + 1;
            return acc;
        }, {});

        return { total, pending, failed, byTable };
    }

    async clearFailedQueueItems(minAttempts = 3) {
        const queue = await db.sync_queue.toArray();
        const failedIds = queue
            .filter((item) => (item.attempt_count ?? 0) >= minAttempts)
            .map((item) => item.id)
            .filter((id): id is number => typeof id === 'number');

        if (failedIds.length === 0) return 0;
        await db.sync_queue.bulkDelete(failedIds);
        return failedIds.length;
    }

    async clearAllQueuedChanges() {
        const count = await db.sync_queue.count();
        if (count > 0) {
            await db.sync_queue.clear();
        }
        return count;
    }

    async resetSyncCursorForCurrentUser() {
        const { data: { session } } = await supabase.auth.getSession();
        const key = this.getLastSyncedKey(session);
        localStorage.removeItem(key);
        return key;
    }

    private isInvalidUuidLiteral(value: unknown): boolean {
        if (typeof value !== 'string') return false;
        const normalized = value.trim().toLowerCase();
        return normalized === '' || normalized === 'null' || normalized === 'undefined';
    }

    private isUuid(value: unknown): value is string {
        if (typeof value !== 'string') return false;
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }

    private async fetchRemoteIds(config: SyncTableConfig): Promise<Set<string> | null> {
        const PAGE_SIZE = 500;
        const remoteIds = new Set<string>();
        let page = 0;

        while (true) {
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            const { data, error } = await supabase
                .from(config.supabase)
                .select('id')
                .order('id', { ascending: true })
                .range(from, to);

            if (error) {
                if (this.isMissingRelationError(error)) {
                    console.warn(`[SyncManager] Skipping delete reconciliation for missing remote table ${config.supabase}: ${error.message}`);
                    return null;
                }
                throw error;
            }

            const rows = data ?? [];
            for (const row of rows) {
                const id = row?.id;
                if (typeof id === 'string' && id) {
                    remoteIds.add(id);
                }
            }

            if (rows.length < PAGE_SIZE) break;
            page += 1;
        }

        return remoteIds;
    }

    private async fetchRemoteDailyLogIdsForUser(userId: string): Promise<Set<string> | null> {
        const PAGE_SIZE = 500;
        const remoteIds = new Set<string>();
        let page = 0;

        while (true) {
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            const { data, error } = await supabase
                .from('daily_logs')
                .select('id')
                .eq('user_id', userId)
                .order('id', { ascending: true })
                .range(from, to);

            if (error) {
                if (this.isMissingRelationError(error)) {
                    console.warn(`[SyncManager] Skipping daily_logs reconcile for missing table: ${error.message}`);
                    return null;
                }
                throw error;
            }

            const rows = data ?? [];
            for (const row of rows) {
                const id = row?.id;
                if (typeof id === 'string' && id) {
                    remoteIds.add(id);
                }
            }

            if (rows.length < PAGE_SIZE) break;
            page += 1;
        }

        return remoteIds;
    }

    private async reconcileDailyLogDeletes(session: any) {
        const userId = session?.user?.id;
        if (!userId) return;

        try {
            const remoteIds = await this.fetchRemoteDailyLogIdsForUser(userId);
            if (!remoteIds) return;

            const localSyncedLogs = await db.logs
                .where('synced')
                .equals(1)
                .and((row: any) => row?.user_id === userId)
                .toArray();

            if (localSyncedLogs.length === 0) return;

            if (remoteIds.size === 0) {
                const { count, error } = await supabase
                    .from('daily_logs')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', userId);

                if (error) {
                    console.warn('[SyncManager] Skipping daily_logs reconcile count check:', error);
                    return;
                }

                if ((count ?? 0) > 0) {
                    console.warn(
                        `[SyncManager] Skipping daily_logs reconcile: id fetch returned empty but count=${count}`
                    );
                    return;
                }
            }

            const idsToDelete = localSyncedLogs
                .map((row: any) => row.id)
                .filter((id: string) => !remoteIds.has(id));

            if (idsToDelete.length > 0) {
                await withRemoteSyncWrite(async () => {
                    await db.logs.bulkDelete(idsToDelete);
                });
                console.log(`[SyncManager] Removed ${idsToDelete.length} stale local log rows missing in remote daily_logs`);
            }
        } catch (error) {
            console.warn('[SyncManager] daily_logs reconcile skipped:', error);
        }
    }

    private async getLocalSyncedPrimaryKeys(tableName: string): Promise<Array<string | number>> {
        const table = db.table(tableName);
        const hasSyncedIndex = ((table as any)?.schema?.indexes ?? []).some((index: any) => index?.name === 'synced');

        if (hasSyncedIndex) {
            return (await table.where('synced').equals(1).primaryKeys()) as Array<string | number>;
        }

        return (await table
            .toCollection()
            .filter((row: any) => row?.synced === 1)
            .primaryKeys()) as Array<string | number>;
    }

    private async reconcileDeletedRows(tables: SyncTableConfig[], session: any) {
        for (const config of tables) {
            if (!config.reconcileDeletes) {
                continue;
            }

            if (!session?.user && !config.public) {
                continue;
            }

            try {
                const remoteIds = await this.fetchRemoteIds(config);
                if (!remoteIds) continue;

                if (config.dexie === 'settings') {
                    const localSettings = await db.settings.get('local-settings');
                    if (localSettings?.synced === 1 && remoteIds.size === 0) {
                        await withRemoteSyncWrite(async () => {
                            await db.settings.delete('local-settings');
                        });
                        console.log('[SyncManager] Removed local settings deleted remotely');
                    }
                    continue;
                }

                const localSyncedIds = await this.getLocalSyncedPrimaryKeys(config.dexie);

                if (remoteIds.size === 0 && localSyncedIds.length > 0) {
                    console.warn(
                        `[SyncManager] Skipping delete reconciliation for ${config.dexie}: remote returned 0 ids while local has ${localSyncedIds.length} synced rows`
                    );
                    continue;
                }

                const idsToDelete = localSyncedIds.filter((id) => !remoteIds.has(String(id)));

                if (idsToDelete.length > 0) {
                    await db.table(config.dexie).bulkDelete(idsToDelete as any[]);
                    console.log(`[SyncManager] Removed ${idsToDelete.length} locally cached ${config.dexie} rows deleted remotely`);
                }
            } catch (error) {
                console.warn(`[SyncManager] Delete reconciliation skipped for ${config.dexie}:`, error);
            }
        }
    }

    private getLastSyncedKey(session: any): string {
        const userId = session?.user?.id;
        if (userId) return `${LAST_SYNCED_KEY_BASE}_${userId}`;
        return `${LAST_SYNCED_KEY_BASE}_public`;
    }

  constructor() {
      if (typeof window !== 'undefined') {
          // Expose for debugging
          // @ts-ignore
          window.syncManager = this;
      }
  }

  start() {
    if (typeof window === 'undefined') return;

    // Listen for online/offline events
    window.addEventListener('online', () => this.sync());
    window.addEventListener('offline', () => this.stop());

    // Initial sync check
    if (navigator.onLine) {
      this.sync();
    }

    // Setup periodic sync
    this.syncInterval = setInterval(() => {
      // console.log('[SyncManager] Interval check - Online:', navigator.onLine, 'Syncing:', this.isSyncing);
      if (navigator.onLine && !this.isSyncing) {
        this.sync();
      }
    }, SYNC_INTERVAL_MS);
  }

  async requeueUnsynced() {
     console.log('[SyncManager] Re-queueing unsynced items...');
     
     // Need type assertion or check if table exists in db
     const tables = [
         'profiles', 'foods', 'food_ingredients', 'logs', 'goals', 'metrics', 
         'settings',
         'activities', 'activity_logs',
         'workout_exercises_def', 'workout_rest_preferences', 'workout_routines', 'workout_routine_entries', 'workout_routine_sets',
         'workouts', 'workout_log_entries', 'workout_sets'
     ] as const;
     
     for (const table of tables) {
         try {
             // @ts-ignore
             const unsynced = await db.table(table).where('synced').equals(0).toArray();
             
             if (unsynced.length > 0) {
                 console.log(`[SyncManager] Found ${unsynced.length} unsynced items in ${table}`);
                 
                 try {
                     // Iterate and add. Since we awaited toArray(), the read transaction is done.
                     // Unless this function was called from an outer transaction scope.
                     // Given the ignoreTransaction issues, let's try direct access.
                     // If called from outer transaction without sync_queue access, this might fail,
                     // but typically this is called from top-level context.
                     for (const item of unsynced) {
                         // Check if already in queue to avoid duplicates
                         const existing = await db.sync_queue
                            .where({ table: table, action: 'create' })
                            .filter((q: any) => q.data.id === item.id)
                            .first();
                            
                         if (!existing) {
                             await db.sync_queue.add({
                                 table,
                                 action: 'create',
                                 data: item,
                                 created_at: Date.now()
                             });
                         }
                     }
                 } catch (e) {
                     console.error(`[SyncManager] Re-queue logic failed:`, e);
                 }
             }
         } catch (e) {
             console.error(`Error scanning ${table}`, e);
         }
     }
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async sync() {
    if (this.isSyncing) {
      console.log('[SyncManager] Sync skipped: Already in progress');
      return;
    }
    this.isSyncing = true;

    try {
      console.log('[SyncManager] Starting sync process...');
      
      const { data: { session } } = await supabase.auth.getSession();
      
      await this.pushChanges(session);
      await this.pullChanges(session);

      console.log('[SyncManager] Sync complete.');
    } catch (error) {
      console.error('[SyncManager] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  async pushChanges(session: any) {
    const queue = await db.sync_queue.orderBy('created_at').toArray();
    if (queue.length === 0) return;

    if (!session?.user) {
        console.log('[SyncManager] No active session. Skipping push.');
        return;
    }

        const actionPriority: Record<SyncQueue['action'], number> = {
            create: 0,
            update: 1,
            delete: 2
        };
        const createTablePriority: Record<string, number> = {
            profiles: 1,
            foods: 2,
            food_ingredients: 3,
            goals: 4,
            metrics: 4,
            settings: 4,
            logs: 5,
            activities: 5,
            activity_logs: 6,
            workout_exercises_def: 7,
            workout_rest_preferences: 8,
            workout_routines: 9,
            workout_routine_entries: 10,
            workout_routine_sets: 11,
            workouts: 12,
            workout_log_entries: 13,
            workout_sets: 14
        };

        const sortedQueue = [...queue].sort((a, b) => {
            const actionDiff = actionPriority[a.action] - actionPriority[b.action];
            if (actionDiff !== 0) return actionDiff;

            if (a.action === 'create' && b.action === 'create') {
                const tableDiff = (createTablePriority[a.table] ?? 999) - (createTablePriority[b.table] ?? 999);
                if (tableDiff !== 0) return tableDiff;
            }

            return a.created_at - b.created_at;
        });

        console.log(`[SyncManager] Pushing ${sortedQueue.length} changes for user ${session.user.id}...`);

        let failedCount = 0;
        this.skippedSharedWorkoutExerciseUpdates = 0;

        for (const item of sortedQueue) {
      try {
        await this.processQueueItem(item, session);
        if (item.id) {
          await db.sync_queue.delete(item.id);
        }
      } catch (error) {
        console.error('Failed to process queue item:', item, error);
                                if (item.id) {
                                        const prevAttempts = item.attempt_count ?? 0;
                                        await db.sync_queue.update(item.id, {
                                                attempt_count: prevAttempts + 1,
                                                last_attempt_at: Date.now(),
                                                last_error: error instanceof Error ? error.message : String(error ?? 'Unknown error')
                                        });
                                }
                failedCount += 1;
      }
    }

        if (this.skippedSharedWorkoutExerciseUpdates > 0) {
            console.log(
                `[SyncManager] Skipped ${this.skippedSharedWorkoutExerciseUpdates} shared workout exercise update(s) (RLS-protected)`
            );
        }

        if (failedCount > 0) {
            console.warn(`[SyncManager] ${failedCount} queue item(s) failed and were kept for retry`);
        }
  }

    private inferCanonicalMealType(value: string): string | null {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return null;

        const valid = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'supplement']);
        if (valid.has(normalized)) return normalized;

        if (normalized.includes('break')) return 'breakfast';
        if (normalized.includes('lunch')) return 'lunch';
        if (normalized.includes('dinner') || normalized.includes('supper')) return 'dinner';
        if (normalized.includes('supplement')) return 'supplement';
        if (normalized.includes('snack')) return 'snack';
        return null;
    }

    private buildMealAliases(value: string): string[] {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return [];

        const slug = normalized
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        const underscore = normalized.replace(/\s+/g, '_');
        const dashed = normalized.replace(/\s+/g, '-');

        return [...new Set([normalized, slug, underscore, dashed].filter(Boolean))];
    }

    private async normalizeDailyLogMealType(rawMealType: unknown): Promise<string> {
        const value = String(rawMealType ?? '').trim().toLowerCase();

        const inferred = this.inferCanonicalMealType(value);
        if (inferred) return inferred;

        const settings = await db.settings.get('local-settings');
        const meals = Array.isArray((settings as any)?.meals) ? (settings as any).meals : [];

        for (const meal of meals) {
            const id = String(meal?.id ?? '');
            const name = String(meal?.name ?? '');
            const aliases = new Set([...this.buildMealAliases(id), ...this.buildMealAliases(name)]);

            if (!aliases.has(value)) continue;

            const nameMatch = this.inferCanonicalMealType(name);
            if (nameMatch) return nameMatch;

            const idMatch = this.inferCanonicalMealType(id);
            if (idMatch) return idMatch;
        }

        return 'snack';
    }

    private getMissingColumnFromError(error: any): string | null {
        if (error?.code !== 'PGRST204' || typeof error?.message !== 'string') return null;
        const match = error.message.match(/Could not find the '([^']+)' column/);
        return match?.[1] ?? null;
    }

    private isMissingRelationError(error: any): boolean {
        return error?.code === '42P01' || (typeof error?.message === 'string' && error.message.includes('does not exist'));
    }

    private isMissingColumnError(error: any): boolean {
        return error?.code === '42703' || error?.code === 'PGRST204';
    }

    private normalizeDottedPayloadKeys(input: Record<string, any>) {
        const output: Record<string, any> = { ...input };

        const setByPath = (target: Record<string, any>, path: string, value: any) => {
            const keys = path.split('.').filter(Boolean);
            if (keys.length === 0) return;

            let cursor: Record<string, any> = target;
            for (let i = 0; i < keys.length - 1; i++) {
                const key = keys[i];
                const existing = cursor[key];
                if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
                    cursor[key] = {};
                }
                cursor = cursor[key];
            }

            cursor[keys[keys.length - 1]] = value;
        };

        Object.entries(input).forEach(([key, value]) => {
            if (!key.includes('.')) return;
            delete output[key];
            setByPath(output, key, value);
        });

        return output;
    }

    private async resolveForbiddenFoodUpdate(foodId: string, sessionUserId?: string | null): Promise<boolean> {
        const { data, error } = await supabase
            .from('foods')
            .select('*')
            .eq('id', foodId)
            .maybeSingle();

        if (error) {
            console.warn('[SyncManager] Failed to inspect forbidden food update target', error);
            return false;
        }

        if (!data) {
            await db.foods.delete(foodId);
            console.log('[SyncManager] Removed local food missing remotely after forbidden update attempt', foodId);
            return true;
        }

        const remoteOwner = data.user_id ?? null;
        const isOwnedByCurrentUser = Boolean(sessionUserId) && remoteOwner === sessionUserId;
        if (isOwnedByCurrentUser) {
            return false;
        }

        await withRemoteSyncWrite(async () => {
            await db.foods.put({ ...data, synced: 1 });
        });
        console.log('[SyncManager] Skipping update for non-owned/public food (RLS-protected)', foodId);
        return true;
    }

    private async shouldSkipStaleRemoteUpdate(table: string, supabaseTable: string, payload: Record<string, any>): Promise<boolean> {
        const id = payload?.id;
        if (!id) return false;
        const localUpdatedAt = payload?.updated_at;

        const { data, error } = await supabase
            .from(supabaseTable)
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            if (this.isMissingRelationError(error)) return false;
            console.warn(`[SyncManager] Could not compare remote freshness for ${supabaseTable}.${id}:`, error);
            return false;
        }

        if (!data) {
            const localId = table === 'settings' ? 'local-settings' : id;
            await withRemoteSyncWrite(async () => {
                await db.table(table).delete(localId as any);
            });
            console.warn(`[SyncManager] Removed local ${table}.${String(localId)} because remote ${supabaseTable}.${String(id)} no longer exists`);
            return true;
        }

        if (!localUpdatedAt) return false;

        const localTs = new Date(localUpdatedAt).getTime();
        if (!Number.isFinite(localTs)) return false;

        if (!data.updated_at) return false;

        const remoteTs = new Date(data.updated_at).getTime();
        if (!Number.isFinite(remoteTs)) return false;

        if (remoteTs <= localTs) return false;

        const normalizedRow = { ...data, synced: 1 };
        if (table === 'settings') {
            normalizedRow.id = 'local-settings';
        }

        await withRemoteSyncWrite(async () => {
            await db.table(table).put(normalizedRow as any);
        });
        console.warn(
            `[SyncManager] Skipping stale local update for ${supabaseTable}.${id}; remote updated_at is newer`
        );
        return true;
    }

  private async processQueueItem(item: SyncQueue, session: any) {
    const { table, action, data } = item;
        const tablesWithUserId = new Set([
            'foods',
            'logs',
            'goals',
            'metrics',
            'settings',
            'activities',
            'activity_logs',
            'workout_exercises_def',
            'workout_rest_preferences',
            'workout_routines',
            'workout_routine_entries',
            'workouts',
            'workout_log_entries'
        ]);
        const strictUserOwnedTables = new Set([
            'logs',
            'goals',
            'metrics',
            'settings',
            'activity_logs',
            'workout_rest_preferences',
            'workout_routines',
            'workout_routine_entries',
            'workouts',
            'workout_log_entries'
        ]);
        const supportsUserId = tablesWithUserId.has(table);
    
    // table mapping
    let supabaseTable = table;
    if (table === 'logs') supabaseTable = 'daily_logs'; 
    if (table === 'metrics') supabaseTable = 'body_metrics'; 
    if (table === 'settings') supabaseTable = 'user_settings';
    
    // For delete, we only need the ID
    if (action === 'delete') {
         // handle both string ID or object with ID
         const rawId = (typeof data === 'object' && data !== null) ? data.id : data;
         let id = rawId;

         if (table === 'settings') {
             const sessionUserId = session?.user?.id;
             if (rawId === 'local-settings' || !this.isUuid(rawId)) {
                 id = sessionUserId;
             }
         }

         if (!id) {
             console.warn('No ID for delete, skipping', item);
             return; 
         }

         if (table === 'settings' && !this.isUuid(id)) {
             console.warn('[SyncManager] Invalid user_settings delete id, skipping', { rawId, resolvedId: id });
             return;
         }
         
         const { error } = await supabase.from(supabaseTable).delete().eq('id', id);
         if (error) throw error;
         return;
    }

    // For create/update, we need to clean the data (remove local-only fields if any)
    const { synced, ...rawPayload } = data;
    let payload = this.normalizeDottedPayloadKeys(rawPayload as Record<string, any>);

        // Permanent behavior: shared/public exercise definitions (user_id null)
        // are reference data and should not be mutated by regular client sync.
        // If product requirements change, adjust this guard and corresponding
        // RLS/server-admin pathways together.
        if (table === 'workout_exercises_def' && action === 'update' && payload.id) {
            const localExercise = await db.workout_exercises_def.get(payload.id);
            const isSharedExercise = !localExercise?.user_id;
            if (isSharedExercise) {
                this.skippedSharedWorkoutExerciseUpdates += 1;
                try {
                    await db.workout_exercises_def.update(payload.id, { synced: 1 });
                } catch (markError) {
                    console.warn('[SyncManager] Failed to mark shared workout exercise as synced after skip', markError);
                }
                return;
            }
        }

        if (table === 'foods' && action === 'update' && payload.id) {
            const localFood = await db.foods.get(payload.id);
            const localOwner = localFood?.user_id ?? null;
            const isOwnedByCurrentUser = Boolean(session?.user?.id) && localOwner === session.user.id;
            if (localFood && !isOwnedByCurrentUser) {
                console.log('[SyncManager] Skipping update for non-owned/public food (RLS-protected)', payload.id);
                try {
                    await db.foods.update(payload.id, { synced: 1 });
                } catch (markError) {
                    console.warn('[SyncManager] Failed to mark non-owned/public food as synced after skip', markError);
                }
                return;
            }
        }

        if (
            table === 'workout_log_entries' &&
            action === 'create' &&
            this.isInvalidUuidLiteral(payload.workout_id)
        ) {
            console.warn('[SyncManager] Dropping malformed workout_log_entries create with invalid workout_id', payload);
            if (payload.id) {
                try {
                    await db.workout_log_entries.delete(payload.id);
                } catch (cleanupError) {
                    console.warn('[SyncManager] Failed to delete malformed local workout_log_entries row', cleanupError);
                }
            }
            return;
        }

        if (!supportsUserId && 'user_id' in payload) {
            delete payload.user_id;
        }
    
    // override user_id with actual authenticated user id
    if (session?.user?.id && supportsUserId) {
         if (table === 'settings') {
             payload.id = session.user.id;
         }
         if (strictUserOwnedTables.has(table)) {
             payload.user_id = session.user.id;
         } else if (
            payload.user_id === 'local-user' ||
            payload.user_id === 'current-user' ||
            (!payload.user_id && !(table === 'workout_exercises_def' && action === 'update'))
         ) {
             payload.user_id = session.user.id;
         }
         // Also ensure ownership for ownable items
         if (['foods', 'activities'].includes(table) && !payload.is_public && (payload.user_id === 'local-user' || payload.user_id === 'current-user' || !payload.user_id)) {
             payload.user_id = session.user.id;
         }
         // If it is public, we should probably set user_id to null if it's 'local-user' or let it be the user's ID if they are creating it
         if (['foods', 'activities'].includes(table) && payload.is_public) {
             // If user creates a public item, they own it initially? Or is it system owned?
             // Based on schema: user_id uuid references auth.users(id), -- Null means global/public food
             // If user_id is null, it's global.
             // If user creates it, normally it should be their ID unless they have admin rights to create null-owner items.
             // Let's assume for now regular users can't create public items freely or if they do, it's theirs.
             if (payload.user_id === 'local-user' || payload.user_id === 'current-user') {
                 payload.user_id = session.user.id;
             }
         }
    } else if (!session?.user?.id) {
        console.warn('[SyncManager] No session user, but sync was attempted.');
    }

        if (supabaseTable === 'daily_logs') {
            payload.meal_type = await this.normalizeDailyLogMealType(payload.meal_type);
        }
    
    const actorLabel = supportsUserId
        ? `user ${payload.user_id ?? 'unknown'}`
        : `id ${payload.id ?? 'unknown'}`;
    console.log(`[SyncManager] Processing ${action} for ${supabaseTable} (${actorLabel})`, payload);

        const shouldRetryWithoutUserId = (error: any) => {
      return (
        supportsUserId &&
        Object.prototype.hasOwnProperty.call(payload, 'user_id') &&
        error?.code === 'PGRST204' &&
        typeof error?.message === 'string' &&
        error.message.includes("'user_id' column")
      );
    };

        const executeCreate = async () => {
            let { error } = await supabase
                .from(supabaseTable)
                .upsert(payload, { onConflict: 'id' });

            if (error && shouldRetryWithoutUserId(error)) {
                console.warn(`[SyncManager] Retrying ${supabaseTable} upsert without user_id due to schema mismatch`);
                delete payload.user_id;
                ({ error } = await supabase
                    .from(supabaseTable)
                    .upsert(payload, { onConflict: 'id' }));
            }

            let missingColumn = this.getMissingColumnFromError(error);
            while (error && missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
                console.warn(`[SyncManager] Retrying ${supabaseTable} upsert without missing column ${missingColumn}`);
                delete payload[missingColumn];
                ({ error } = await supabase
                    .from(supabaseTable)
                    .upsert(payload, { onConflict: 'id' }));
                missingColumn = this.getMissingColumnFromError(error);
            }

            return error;
        };

        const executeUpdate = async () => {
            let { error } = await supabase
                .from(supabaseTable)
                .upsert(payload, { onConflict: 'id' });

            if (error && shouldRetryWithoutUserId(error)) {
                console.warn(`[SyncManager] Retrying ${supabaseTable} upsert(update) without user_id due to schema mismatch`);
                delete payload.user_id;
                ({ error } = await supabase
                    .from(supabaseTable)
                    .upsert(payload, { onConflict: 'id' }));
            }

            let missingColumn = this.getMissingColumnFromError(error);
            while (error && missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
                console.warn(`[SyncManager] Retrying ${supabaseTable} upsert(update) without missing column ${missingColumn}`);
                delete payload[missingColumn];
                ({ error } = await supabase
                    .from(supabaseTable)
                    .upsert(payload, { onConflict: 'id' }));
                missingColumn = this.getMissingColumnFromError(error);
            }

            return error;
        };

    if (action === 'create') {
                const error = await executeCreate();
        if (error) { 
            console.error('[SyncManager] Insert error:', error);
            throw error; 
        }
    } else if (action === 'update') {
        if (!payload.id) throw new Error('No ID for update');

        const staleLocalUpdate = await this.shouldSkipStaleRemoteUpdate(table, supabaseTable, payload);
        if (staleLocalUpdate) {
            return;
        }

                const error = await executeUpdate();
        if (table === 'foods' && error?.code === '42501') {
            const handled = await this.resolveForbiddenFoodUpdate(payload.id, session?.user?.id ?? null);
            if (handled) {
                return;
            }
        }
        if (error) throw error;
    }

    // Mark as synced locally
    // We need to update the local record to set synced=1
    // But wait, updating it will trigger the 'updating' hook!
    // We need to make sure we pass synced=1 so the hook ignores it.
    try {
        const id = payload.id;
        if (id) {
            await db.table(table).update(id, { synced: 1 });
        }
    } catch (e) {
        console.warn('[SyncManager] Failed to mark local item as synced', e);
    }
  }

  async pullChanges(session: any) {
        const lastSyncedKey = this.getLastSyncedKey(session);
        const lastSyncedAt = localStorage.getItem(lastSyncedKey);
    let lastSyncedDate = lastSyncedAt || new Date(0).toISOString();

    // Track max timestamp globally for the sync cycle to ensure we don't miss updates
    // Initialize properly
    if (lastSyncedAt) {
       // ensure valid date
       try {
           new Date(lastSyncedAt).toISOString();
       } catch (e) {
           lastSyncedDate = new Date(0).toISOString();
       }
    }
    
    let maxTimestamp = lastSyncedDate;
    let hasChanges = false;
    let hadPullErrors = false;

    const tables: SyncTableConfig[] = [
        { dexie: 'profiles', supabase: 'profiles', dateField: 'updated_at' },
        { dexie: 'foods', supabase: 'foods', dateField: 'updated_at', public: true },
        { dexie: 'food_ingredients', supabase: 'food_ingredients', dateField: 'updated_at', fallbackDateField: 'created_at', public: true },
        { dexie: 'logs', supabase: 'daily_logs', dateField: 'updated_at', fallbackDateField: 'created_at' },
        { dexie: 'goals', supabase: 'goals', dateField: 'updated_at', fallbackDateField: 'created_at' },
        { dexie: 'metrics', supabase: 'body_metrics', dateField: 'updated_at', fallbackDateField: 'created_at' },
        { dexie: 'settings', supabase: 'user_settings', dateField: 'updated_at', reconcileDeletes: true },
        { dexie: 'activities', supabase: 'activities', dateField: 'updated_at', public: true },
        { dexie: 'activity_logs', supabase: 'activity_logs', dateField: 'updated_at', fallbackDateField: 'created_at' },
        { dexie: 'workout_exercises_def', supabase: 'workout_exercises_def', dateField: 'updated_at', public: true },
        { dexie: 'workout_rest_preferences', supabase: 'workout_rest_preferences', dateField: 'updated_at' },
        { dexie: 'workout_routines', supabase: 'workout_routines', dateField: 'updated_at' },
        { dexie: 'workout_routine_entries', supabase: 'workout_routine_entries', dateField: 'updated_at', fallbackDateField: 'created_at' },
        { dexie: 'workout_routine_sets', supabase: 'workout_routine_sets', dateField: 'updated_at', fallbackDateField: 'created_at' },
        { dexie: 'workouts', supabase: 'workouts', dateField: 'updated_at' },
        { dexie: 'workout_log_entries', supabase: 'workout_log_entries', dateField: 'updated_at', fallbackDateField: 'created_at' },
        { dexie: 'workout_sets', supabase: 'workout_sets', dateField: 'updated_at', fallbackDateField: 'created_at' }
    ];
    
    // Batch size to prevent large payloads
    const BATCH_SIZE = 100; // conservative batch size

    for (const config of tables) {
        // Skip private tables if no session
        if (!session?.user && !config.public) {
             continue;
        }

        let queryDateField = config.dateField;

        let page = 0;
        let fetchMore = true;
        
        while (fetchMore) {
            let retryCount = 0;
            let success = false;
            let data: any[] | null = null;
            let error: any = null;

            while (retryCount < 3 && !success) {
                try {
                    const result = await supabase
                        .from(config.supabase)
                        .select(config.select || '*')
                        .gt(queryDateField, lastSyncedDate)
                        .order(queryDateField, { ascending: true })
                        .order('id', { ascending: true }) // stable sort
                        .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1);
                    
                    data = result.data;
                    error = result.error;
                    
                    if (!error) {
                        success = true;
                    } else {
                        if (
                            config.fallbackDateField &&
                            queryDateField !== config.fallbackDateField &&
                            this.isMissingColumnError(error) &&
                            typeof error?.message === 'string' &&
                            error.message.includes(`${config.supabase}.${queryDateField}`)
                        ) {
                            console.warn(
                                `[SyncManager] ${config.supabase}.${queryDateField} missing; falling back to ${config.fallbackDateField} for pull sync.`
                            );
                            queryDateField = config.fallbackDateField;
                            continue;
                        }

                        if (this.isMissingRelationError(error)) {
                            console.warn(`[SyncManager] Skipping missing remote table ${config.supabase}: ${error.message}`);
                            break;
                        }

                        // If error is not network related (e.g. bad request), don't retry
                        if (error.code && !['PGRST', '500', '502', '503', '504'].some(c => error.code.startsWith(c)) && !error.message?.includes('fetch')) {
                             break;
                        }
                        console.warn(`[SyncManager] Retry ${retryCount + 1}/3 for ${config.supabase} failed:`, error.message);
                        retryCount++;
                        if (retryCount < 3) await new Promise(r => setTimeout(r, 1000 * retryCount)); // Backoff
                    }
                } catch (e) {
                    error = e;
                    console.warn(`[SyncManager] Retry ${retryCount + 1}/3 for ${config.supabase} exception:`, e);
                    retryCount++;
                    if (retryCount < 3) await new Promise(r => setTimeout(r, 1000 * retryCount));
                }
            }

            if (error || !success) {
                if (this.isMissingRelationError(error)) {
                    fetchMore = false;
                    continue;
                }

                console.error(`Failed to pull ${config.supabase} after retries:`, error);
                // If network error, stop syncing entirely
                if (error && error.message && (error.message.includes('Load failed') || error.message.includes('Network request failed') || error.message.includes('fetch'))) {
                    throw error;
                }
                hadPullErrors = true;
                fetchMore = false; // Stop fetching this table on error but maybe continue others? No, rethrow stopped it.
                continue;
            }

            if (data && data.length > 0) {
                console.log(`[SyncManager] Pulled ${data.length} records for ${config.dexie} (page ${page})`);
                
                // Update local DB
                const rows = (data as any[]).map(row => {
                    const normalizedRow = { ...row, synced: 1 };
                    if (config.dexie === 'settings') {
                        normalizedRow.id = 'local-settings';
                    }
                    return normalizedRow;
                });
                await withRemoteSyncWrite(async () => {
                    await db.table(config.dexie).bulkPut(rows);
                });
                hasChanges = true;

                // Track max timestamp from the data we just received
                for (const row of (data as any[])) {
                    const ts = row[queryDateField];
                    if (ts > maxTimestamp) maxTimestamp = ts;
                }
                
                // If we got less than BATCH_SIZE, we are done
                if (data.length < BATCH_SIZE) {
                    fetchMore = false;
                } else {
                    page++;
                }
            } else {
                fetchMore = false;
            }
        }
    }

    // Only update timestamp if we successfully completed sync and processed changes
    // But even if no changes, we should update to now? No, update to maxTimestamp see
    if (hadPullErrors) {
        console.warn('[SyncManager] Pull completed with table errors. Keeping last sync cursor unchanged for retry.');
        return;
    }

    // Delete reconciliation disabled globally to avoid accidental local data loss when
    // remote snapshots are incomplete or temporarily inconsistent.
    // Keep a narrow, user-scoped reconcile for daily logs to remove stale local-only rows.
    // Daily log delete reconciliation is intentionally disabled to avoid
    // accidental local removals from transient remote/list inconsistencies.
    // Users can manually clear stale local rows when needed.

    if (hasChanges && maxTimestamp > lastSyncedDate) {
        localStorage.setItem(lastSyncedKey, maxTimestamp); 
    }
  }
}

export const syncManager = new SyncManager();
