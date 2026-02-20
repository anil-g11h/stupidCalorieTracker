
<script>
  import Router from 'svelte-spa-router';
  import Layout from './routes/+layout.svelte';
  import { BASE_URL } from '$lib/constants';

  import Home from './routes/Home.svelte';
  import Workouts from './routes/Workouts.svelte';
  import Log from './routes/Log.svelte';
  import Time from './routes/Time.svelte';
  import Profile from './routes/Profile.svelte';
  import Foods from './routes/foods/Foods.svelte';
  import NewFood from './routes/foods/new/NewFood.svelte';
  import NewRecipe from './routes/foods/new-recipe/NewRecipe.svelte';
  import AddLog from './routes/log/add/AddLog.svelte';
  import Activities from './routes/time/activities/Activities.svelte';
  import AddActivityLog from './routes/time/add/AddActivityLog.svelte';
  import Exercises from './routes/workouts/exercises/Exercises.svelte';
  import NewExercise from './routes/workouts/exercises/new/NewExercise.svelte'; 
  import WorkoutDetail from './routes/workouts/[id]/Workouts.svelte';

  const routes = {
    '/': Home,
    '/workouts/exercises/new': NewExercise,
    '/workouts/exercises': Exercises,
    '/workouts/:id': WorkoutDetail,
    '/workouts': Workouts,
    '/log': Log,
    '/log/add': AddLog,
    '/time': Time,
    '/time/activities': Activities,
    '/time/add': AddActivityLog,
    '/foods': Foods,
    '/foods/new': NewFood,
    '/foods/new-recipe': NewRecipe,
    '/profile': Profile,
  };
</script>

<Layout>
  <Router {routes} useHash={true} basepath={`/${BASE_URL}`} />
</Layout>
