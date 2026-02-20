<!-- <script lang="ts">
	import '../app.css';
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	import { onMount, type Snippet } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { supabase } from '$lib/supabaseClient';
	import { syncManager } from '$lib/sync';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import IosInstallPrompt from '$lib/components/IosInstallPrompt.svelte';

	let { children }: { children: Snippet } = $props();


	onMount(async () => {
	});

	onMount(() => {
		syncManager.start();

		const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
			if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
				// Trigger sync immediately on login to fetch user data
				syncManager.sync();
			}
		});

		return () => {
			syncManager.stop();
			subscription.unsubscribe();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex flex-col min-h-[100dvh] bg-page text-text-main pb-20 font-sans antialiased selection:bg-rose-500 selection:text-white">
    <IosInstallPrompt />
    <main class="flex-1 w-full max-w-md mx-auto p-4 space-y-6">
        {@render children()}
    </main>


    <BottomNav />
</div> -->
