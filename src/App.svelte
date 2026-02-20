<script>
  import Router from 'svelte-spa-router';
  import Home from './routes/Home.svelte';
  import Workouts from './routes/Workouts.svelte';
  // Import other pages as needed

  const routes = {
    '/': Home,
    '/workouts': Workouts,
    // Add other routes here
  };
</script>

<Router {routes} />
