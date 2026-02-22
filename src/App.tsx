import React from 'react';
import Home from './routes/Home';
import Layout from './routes/Layout';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import Log from './routes/Log';
import FoodList from './routes/foods/Foods';
import NewFood from './routes/foods/new/NewFood';
import NewRecipe from './routes/foods/new-recipe/NewRecipe';
import AddLogEntry from './routes/log/add/AddLog';
import WorkoutList from './routes/workouts/Workouts';
import WorkoutStart from './routes/workouts/WorkoutStart';
import WorkoutSessionComponent from './routes/workouts/[id]/WorkoutSession';
import ExerciseSelector from './routes/workouts/exercises/ExercisesList';
import ExerciseDetails from './routes/workouts/exercises/ExerciseDetails';
import NewExercise from './routes/workouts/exercises/new/NewExercise';
import RoutineEditor from './routes/workouts/routines/RoutineEditor';
import ProfileAndGoals from './routes/profile/Profile';

function App() {
return (
    <Layout>
      <Routes>
        <Route path="/log" element={<Log />} />
        <Route path="/log/add" element={<AddLogEntry />} />
        <Route path="/" element={<Home />} />
        <Route path="/foods" element={<FoodList />} />
        <Route path="/foods/new" element={<NewFood />} />
        <Route path="/foods/:id/edit" element={<NewFood />} />
        <Route path="/foods/new-recipe" element={<NewRecipe />} />
        <Route path="/workouts" element={<WorkoutList />} />
        <Route path="/workouts/start" element={<WorkoutStart />} />
        <Route path="/workouts/routines/:id" element={<RoutineEditor />} />
        <Route path="/workouts/:id" element={<WorkoutSessionComponent />} />
        <Route path="/workouts/exercises" element={<ExerciseSelector />} />
        <Route path="/workouts/exercises/:id" element={<ExerciseDetails />} />
        <Route path="/workouts/exercises/new" element={<NewExercise />} />
        <Route path="/profile" element={<ProfileAndGoals />} />

      </Routes>
    </Layout>
  );
}

export default App;
