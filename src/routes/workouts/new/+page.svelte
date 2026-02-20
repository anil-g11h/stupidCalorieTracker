<script lang="ts">
  import { db } from '$lib/db';
  import { generateId } from '$lib';
  import { goto } from '$app/navigation';
    import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabaseClient';

  onMount(async () => {
    try {
        // Get real user ID if possible
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id || 'current-user';

        const id = generateId();
        const now = new Date().toISOString();
        
        await db.workouts.add({
            id,
            user_id: userId,
            name: 'Workout',
            start_time: now,
            created_at: new Date(),
            updated_at: new Date(),
            synced: 0
        });

        await goto(`${base}/workouts/${id}`, { replaceState: true });
    } catch (e) {
        console.error("Failed to start workout:", e);
        alert("Failed to start workout. check console.");
    }
  });
</script>

<div class="flex items-center justify-center h-screen">
  <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto mb-4"></div>
      <p class="text-text-muted">Starting workout...</p>
  </div>
</div>
