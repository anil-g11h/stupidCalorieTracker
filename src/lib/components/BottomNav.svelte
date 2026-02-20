<script lang="ts">
  import { Home, PlusCircle, User, Clock, Dumbbell } from 'lucide-svelte';
  // svelte-spa-router: use window.location.hash for active state
  let currentPath = '';

  function updatePath() {
    currentPath = window.location.hash.replace('#', '') || '/';
  }

  updatePath();
  window.addEventListener('hashchange', updatePath);

  const links = [
    { href: '#/', label: 'Home', icon: Home },
    { href: '#/log', label: 'Log', icon: PlusCircle },
    // { href: '#/log/add', label: 'Add Log', icon: PlusCircle },
    { href: '#/time', label: 'Time', icon: Clock },
    // { href: '#/time/activities', label: 'Activities', icon: Clock },
    // { href: '#/time/add', label: 'Add Activity', icon: PlusCircle },
    { href: '#/workouts', label: 'Gym', icon: Dumbbell },
    // { href: '#/workouts/new', label: 'New Workout', icon: Dumbbell },
    // { href: '#/workouts/exercises', label: 'Exercises', icon: Dumbbell },
    // { href: '#/foods', label: 'Foods', icon: PlusCircle },
    // { href: '#/foods/new', label: 'New Food', icon: PlusCircle },
    // { href: '#/foods/new-recipe', label: 'New Recipe', icon: PlusCircle },
    { href: '#/profile', label: 'Me', icon: User },
  ];
</script>

<nav class="fixed bottom-0 left-0 right-0 border-t bg-card pb-safe pt-2 border-border-subtle">
  <div class="flex justify-around items-center h-14">
    {#each links as link}
      {@const Icon = link.icon}
      <a 
        href="/StupidCaloriesTracker/#/log"
        class="flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors"
        class:text-brand={currentPath === link.href.replace('#', '')}
        class:text-text-muted={currentPath !== link.href.replace('#', '')}
      >
        <Icon size={20} strokeWidth={2.5} />
        <span>{link.label}</span>
      </a>
    {/each}
  </div>
</nav>
