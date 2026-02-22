import { db, type SyncQueue } from './db';
import { supabase } from './supabaseClient';
import Dexie from 'dexie';

const SYNC_INTERVAL_MS = 30000; // 30 seconds
const LAST_SYNCED_KEY_BASE = 'stupid_calorie_tracker_last_synced';

export class SyncManager {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

    private isInvalidUuidLiteral(value: unknown): boolean {
        if (typeof value !== 'string') return false;
        const normalized = value.trim().toLowerCase();
        return normalized === '' || normalized === 'null' || normalized === 'undefined';
    }

    private async reconcileDeletedFoods() {
        const PAGE_SIZE = 500;
        const remoteFoodIds = new Set<string>();
        let page = 0;

        while (true) {
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            const { data, error } = await supabase
                .from('foods')
                .select('id')
                .order('id', { ascending: true })
                .range(from, to);

            if (error) throw error;

            const rows = data ?? [];
            for (const row of rows) {
                if (row?.id) remoteFoodIds.add(row.id);
            }

            if (rows.length < PAGE_SIZE) break;
            page += 1;
        }

        const localSyncedFoodIds = (await db.foods.where('synced').equals(1).primaryKeys()) as string[];
        const idsToDelete = localSyncedFoodIds.filter((id) => !remoteFoodIds.has(id));

        if (idsToDelete.length > 0) {
            await db.foods.bulkDelete(idsToDelete);
            console.log(`[SyncManager] Removed ${idsToDelete.length} locally cached foods deleted remotely`);
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

        for (const item of sortedQueue) {
      try {
        await this.processQueueItem(item, session);
        if (item.id) {
          await db.sync_queue.delete(item.id);
        }
      } catch (error) {
        console.error('Failed to process queue item:', item, error);
                failedCount += 1;
      }
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

  private async processQueueItem(item: SyncQueue, session: any) {
    const { table, action, data } = item;
        const tablesWithUserId = new Set([
            'foods',
            'logs',
            'goals',
            'metrics',
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
    
    // For delete, we only need the ID
    if (action === 'delete') {
         // handle both string ID or object with ID
         const id = (typeof data === 'object' && data !== null) ? data.id : data;
         
         if (!id) {
             console.warn('No ID for delete, skipping', item);
             return; 
         }
         
         const { error } = await supabase.from(supabaseTable).delete().eq('id', id);
         if (error) throw error;
         return;
    }

    // For create/update, we need to clean the data (remove local-only fields if any)
    const { synced, ...rawPayload } = data;
    let payload = this.normalizeDottedPayloadKeys(rawPayload as Record<string, any>);

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
         if (strictUserOwnedTables.has(table)) {
             payload.user_id = session.user.id;
         } else if (payload.user_id === 'local-user' || payload.user_id === 'current-user' || !payload.user_id) {
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
    
    console.log(`[SyncManager] Processing ${action} for ${supabaseTable} with user ${payload.user_id}`, payload);

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
                const error = await executeUpdate();
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

    // Tables to sync
    interface TableConfig {
        dexie: string;
        supabase: string;
        dateField: string;
        public?: boolean;
        select?: string; // Limit fields if needed
    }

    const tables: TableConfig[] = [
        { dexie: 'profiles', supabase: 'profiles', dateField: 'updated_at' },
        { dexie: 'foods', supabase: 'foods', dateField: 'updated_at', public: true },
        { dexie: 'food_ingredients', supabase: 'food_ingredients', dateField: 'created_at', public: true },
        { dexie: 'logs', supabase: 'daily_logs', dateField: 'created_at' },
        { dexie: 'goals', supabase: 'goals', dateField: 'created_at' },
        { dexie: 'metrics', supabase: 'body_metrics', dateField: 'created_at' },
        { dexie: 'activities', supabase: 'activities', dateField: 'updated_at', public: true },
        { dexie: 'activity_logs', supabase: 'activity_logs', dateField: 'created_at' },
        { dexie: 'workout_exercises_def', supabase: 'workout_exercises_def', dateField: 'updated_at', public: true },
        { dexie: 'workout_rest_preferences', supabase: 'workout_rest_preferences', dateField: 'updated_at' },
        { dexie: 'workout_routines', supabase: 'workout_routines', dateField: 'updated_at' },
        { dexie: 'workout_routine_entries', supabase: 'workout_routine_entries', dateField: 'created_at' },
        { dexie: 'workout_routine_sets', supabase: 'workout_routine_sets', dateField: 'created_at' },
        { dexie: 'workouts', supabase: 'workouts', dateField: 'updated_at' },
        { dexie: 'workout_log_entries', supabase: 'workout_log_entries', dateField: 'created_at' },
        { dexie: 'workout_sets', supabase: 'workout_sets', dateField: 'created_at' }
    ];
    
    // Batch size to prevent large payloads
    const BATCH_SIZE = 100; // conservative batch size

    for (const config of tables) {
        // Skip private tables if no session
        if (!session?.user && !config.public) {
             continue;
        }

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
                        .gt(config.dateField, lastSyncedDate)
                        .order(config.dateField, { ascending: true })
                        .order('id', { ascending: true }) // stable sort
                        .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1);
                    
                    data = result.data;
                    error = result.error;
                    
                    if (!error) {
                        success = true;
                    } else {
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
                const rows = (data as any[]).map(row => ({ ...row, synced: 1 }));
                await db.table(config.dexie).bulkPut(rows);
                hasChanges = true;

                // Track max timestamp from the data we just received
                for (const row of (data as any[])) {
                    const ts = row[config.dateField];
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

    await this.reconcileDeletedFoods();

    if (hasChanges && maxTimestamp > lastSyncedDate) {
        localStorage.setItem(lastSyncedKey, maxTimestamp); 
    } else if (!hasChanges) {
        // If no changes at all, we can update to now() only if we are sure we checked everything
        // But safely, let's just keep lastSyncedDate. 
        // Or update to now() to avoid checking old range repeatedly?
        // If we queried with gt(lastSyncedDate) and got 0 results, 
        // it means state IS synced up to now().
        localStorage.setItem(lastSyncedKey, new Date().toISOString());
    }
  }
}

export const syncManager = new SyncManager();
