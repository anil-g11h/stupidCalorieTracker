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
import WorkoutSessionComponent from './routes/workouts/[id]/WorkoutSession';
import ExerciseSelector from './routes/workouts/exercises/ExercisesList';
import NewExercise from './routes/workouts/exercises/new/NewExercise';

function App() {
return (
    <Layout>
      <Routes>
        <Route path="/log" element={<Log />} />
        <Route path="/log/add" element={<AddLogEntry />} />
        <Route path="/" element={<Home />} />
        <Route path="/foods" element={<FoodList />} />
        <Route path="/foods/new" element={<NewFood />} />
        <Route path="/foods/new-recipe" element={<NewRecipe />} />
        <Route path="/workouts" element={<WorkoutList />} />
        <Route path="/workouts/:id" element={<WorkoutSessionComponent />} />
        <Route path="/workouts/exercises" element={<ExerciseSelector />} />
        <Route path="/workouts/exercises/new" element={<NewExercise />} />

      </Routes>
    </Layout>
  );
}

export default App;
