<script lang="ts">
	import { db, type DailyLog, type Food } from '$lib/db';
	import { liveQueryStore } from '$lib/stores/liveQuery';
	import { Plus, Utensils, ChevronLeft, ChevronRight, Calendar } from 'lucide-svelte';
	import { base } from '$app/paths';

	// State for Date Navigation
	let currentDate = new Date();
	
	function changeDate(days: number) {
		const newDate = new Date(currentDate);
		newDate.setDate(currentDate.getDate() + days);
		currentDate = newDate;
	}

	function getYyyyMmDd(date: Date) {
		const yyyy = date.getFullYear();
		const mm = String(date.getMonth() + 1).padStart(2, '0');
		const dd = String(date.getDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	$: formattedDate = getYyyyMmDd(currentDate);
	$: displayDate = currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
	$: isToday = formattedDate === getYyyyMmDd(new Date());

	// Reactive Store for Data - updates when formattedDate changes
	$: data = liveQueryStore(async () => {
		// 1. Fetch Logs for selected date
		const logs = await db.logs.where('date').equals(formattedDate).toArray();

		// 2. Fetch Associated Foods
		const foodIds = logs.map((l) => l.food_id);
		// bulkGet returns (T | undefined)[] in same order as keys
		const foods = await db.foods.bulkGet(foodIds);

		// Join Logs with Foods
		const logsWithFood = logs.map((log, i) => {
			const food = foods[i];
			if (!food) return null;
			return {
				...log,
				food
			};
		}).filter((item): item is DailyLog & { food: Food } => item !== null);

		// 3. Fetch Goal (latest active goal relative to selected date)
		const goal = await db.goals
			.where('start_date')
			.belowOrEqual(formattedDate)
			.reverse()
			.first();

		return {
			logs: logsWithFood,
			goal
		};
	});

	// Derived Calculations
	$: logs = $data?.logs ?? [];
	$: goal = $data?.goal;

	$: totalCalories = logs.reduce((sum, item) => sum + (item.food.calories * item.amount_consumed), 0);
	$: totalProtein = logs.reduce((sum, item) => sum + (item.food.protein * item.amount_consumed), 0);
	$: totalCarbs = logs.reduce((sum, item) => sum + (item.food.carbs * item.amount_consumed), 0);
	$: totalFat = logs.reduce((sum, item) => sum + (item.food.fat * item.amount_consumed), 0);

	// Goal Targets (Defaults just in case)
	$: goalCalories = goal?.calories_target || 2000;
	$: goalProtein = goal?.protein_target || 150;
	$: goalCarbs = goal?.carbs_target || 200;
	$: goalFat = goal?.fat_target || 60;

	// Progress Percentages
	$: pctCalories = Math.min((totalCalories / goalCalories) * 100, 100);
	$: pctProtein = Math.min((totalProtein / goalProtein) * 100, 100);
	$: pctCarbs = Math.min((totalCarbs / goalCarbs) * 100, 100);
	$: pctFat = Math.min((totalFat / goalFat) * 100, 100);
</script>

<div class="min-h-screen bg-page pb-20 font-sans">
	<!-- Header -->
	<header class="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
		<div class="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
			<h1 class="text-xl font-bold text-text-main hidden sm:block">Dashboard</h1>
			
			<div class="flex items-center justify-between w-full sm:w-auto bg-surface rounded-full px-1 py-1 border border-border-subtle shadow-sm mx-auto sm:mx-0">
				<button 
					class="p-2 hover:bg-card rounded-full transition-colors text-text-muted hover:text-text-main"
					on:click={() => changeDate(-1)}
					aria-label="Previous day"
				>
					<ChevronLeft size={18} />
				</button>
				
				<button 
					class="flex flex-col items-center px-4 cursor-pointer hover:bg-card/50 rounded-lg transition-colors py-1" 
					on:click={() => { currentDate = new Date(); }}
					title="Jump to Today"
				>
					<span class="text-sm font-bold text-text-main leading-none flex items-center gap-1.5">
						<Calendar size={12} class="text-brand" />
						{isToday ? 'Today' : displayDate}
					</span>
					{#if !isToday}
						<span class="text-[10px] text-text-muted leading-none mt-0.5">{displayDate}</span>
					{/if}
				</button>

				<button 
					class="p-2 hover:bg-card rounded-full transition-colors text-text-muted hover:text-text-main"
					on:click={() => changeDate(1)}
					aria-label="Next day"
				>
					<ChevronRight size={18} />
				</button>
			</div>
		</div>
	</header>

	<main class="max-w-md mx-auto p-4 space-y-6">
		<!-- Progress Overview Card -->
		<div class="bg-card rounded-2xl shadow-sm p-6 border border-border-subtle">
			<div class="flex justify-between items-end mb-2">
				<div>
					<p class="text-sm text-text-muted font-medium uppercase tracking-wide">Calories</p>
					<div class="flex items-baseline gap-1 mt-1">
						<span class="text-4xl font-extrabold text-text-main">{Math.round(totalCalories)}</span>
						<span class="text-sm text-text-muted font-medium">/ {goalCalories}</span>
					</div>
				</div>
				<div class="text-right mb-1">
					<p class="text-xs font-bold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 px-3 py-1 rounded-full inline-block">
						{Math.round(goalCalories - totalCalories)} LEFT
					</p>
				</div>
			</div>

			<!-- Calorie Progress Bar -->
			<div class="h-4 bg-surface rounded-full overflow-hidden mb-8 shadow-inner">
				<div 
					class="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-700 ease-out shadow-sm"
					style="width: {pctCalories}%"
				></div>
			</div>

			<!-- Macros Grid -->
			<div class="grid grid-cols-3 gap-6">
				<!-- Protein -->
				<div class="text-center">
					<p class="text-xs text-text-muted mb-2 font-medium">Protein</p>
					<div class="relative h-2 bg-surface rounded-full mb-2">
						<div class="absolute top-0 left-0 h-full bg-macro-protein rounded-full transition-all duration-500" style="width: {pctProtein}%"></div>
					</div>
					<p class="text-xs font-bold text-text-main">{Math.round(totalProtein)} <span class="text-text-muted font-normal">/ {goalProtein}g</span></p>
				</div>
				<!-- Carbs -->
				<div class="text-center">
					<p class="text-xs text-text-muted mb-2 font-medium">Carbs</p>
					<div class="relative h-2 bg-surface rounded-full mb-2">
						<div class="absolute top-0 left-0 h-full bg-macro-carbs rounded-full transition-all duration-500" style="width: {pctCarbs}%"></div>
					</div>
					<p class="text-xs font-bold text-text-main">{Math.round(totalCarbs)} <span class="text-text-muted font-normal">/ {goalCarbs}g</span></p>
				</div>
				<!-- Fat -->
				<div class="text-center">
					<p class="text-xs text-text-muted mb-2 font-medium">Fat</p>
					<div class="relative h-2 bg-surface rounded-full mb-2">
						<div class="absolute top-0 left-0 h-full bg-macro-fat rounded-full transition-all duration-500" style="width: {pctFat}%"></div>
					</div>
					<p class="text-xs font-bold text-text-main">{Math.round(totalFat)} <span class="text-text-muted font-normal">/ {goalFat}g</span></p>
				</div>
			</div>
		</div>

		<!-- Recent Logs -->
		<div>
			<h2 class="text-lg font-bold text-text-main mb-4 px-1">{isToday ? "Today's Meals" : "Meals"}</h2>
			
			{#if !$data}
				<div class="flex justify-center p-12">
					<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
				</div>
			{:else if logs.length === 0}
				<div class="text-center py-12 bg-card rounded-2xl border-2 border-dashed border-border-subtle">
					<div class="bg-surface h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4">
						<Utensils class="w-8 h-8 text-text-muted" />
					</div>
					<p class="text-text-muted font-medium mb-2">No meals logged {isToday ? 'today' : 'on this day'}</p>
					{#if isToday}
						<a href="{base}/log" class="text-blue-600 dark:text-blue-400 text-sm font-semibold hover:underline">Start logging now</a>
					{/if}
				</div>
			{:else}
				<div class="space-y-3">
					{#each logs as log (log.id)}
						<div class="bg-card p-4 rounded-xl shadow-sm border border-border-subtle flex justify-between items-center transition-all hover:shadow-md active:scale-[0.99] group">
							<div class="flex-1">
								<div class="flex items-center gap-2 mb-1">
									<h3 class="font-bold text-text-main group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{log.food.name}</h3>
									<span class="text-[10px] font-bold uppercase tracking-wider text-text-muted bg-surface px-2 py-0.5 rounded-full">{log.meal_type}</span>
								</div>
								<p class="text-xs text-text-muted">
									{log.amount_consumed} {log.food.serving_unit || 'svg'}
								</p>
							</div>
							<div class="text-right">
								<p class="font-bold text-text-main text-lg leading-tight">{Math.round(log.food.calories * log.amount_consumed)} <span class="text-xs font-normal text-text-muted">cal</span></p>
								<div class="text-[10px] text-text-muted font-medium flex gap-1 justify-end mt-1">
									<span class="bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-1 rounded">{Math.round(log.food.protein * log.amount_consumed)}p</span>
									<span class="bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-1 rounded">{Math.round(log.food.carbs * log.amount_consumed)}c</span>
									<span class="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-1 rounded">{Math.round(log.food.fat * log.amount_consumed)}f</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</main>

	<!-- Floating Action Button -->
	<a 
		href="{base}/log" 
		class="fixed bottom-24 right-5 z-30 flex items-center justify-center w-14 h-14 bg-brand text-brand-fg rounded-full shadow-lg shadow-brand/30 hover:bg-brand/90 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-brand/30"
		aria-label="Log food"
	>
		<Plus class="w-8 h-8 stroke-[3]" />
	</a>

</div>