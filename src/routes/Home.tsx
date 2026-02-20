import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, type Food, type Goal, type UserSettings } from '../lib/db';

type SettingsRow = UserSettings & { id: 'local-settings' };

const SETTINGS_ID: SettingsRow['id'] = 'local-settings';

function toYyyyMmDd(date: Date) {
  return date.toISOString().split('T')[0];
}

function getWeekStart(date: Date) {
  const start = new Date(date);
  const day = start.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getWorkoutDurationMinutes(startTime: string, endTime?: string) {
  if (!endTime) return 0;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export default function Home() {
  const now = new Date();
  const today = useMemo(() => toYyyyMmDd(now), [now]);
  const weekStartIso = useMemo(() => getWeekStart(now).toISOString(), [now]);

  const data = useLiveQuery(async () => {
    const [todayLogs, settings, workouts, goal] = await Promise.all([
      db.logs.where('date').equals(today).toArray(),
      db.settings.get(SETTINGS_ID as string) as Promise<SettingsRow | undefined>,
      db.workouts.toArray(),
      db.goals.where('start_date').belowOrEqual(today).reverse().first() as Promise<Goal | undefined>
    ]);

    const foodIds = [...new Set(todayLogs.map((log) => log.food_id))];
    const foods = foodIds.length ? await db.foods.where('id').anyOf(foodIds).toArray() : [];
    const foodsMap = foods.reduce<Record<string, Food>>((acc, food) => {
      acc[food.id] = food;
      return acc;
    }, {});

    const calorieTotals = todayLogs.reduce(
      (acc, log) => {
        const food = foodsMap[log.food_id];
        if (!food) return acc;
        const amount = Number(log.amount_consumed) || 0;
        acc.calories += food.calories * amount;
        acc.protein += food.protein * amount;
        acc.carbs += food.carbs * amount;
        acc.fat += food.fat * amount;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    const thisWeekWorkouts = workouts.filter((workout) => workout.start_time >= weekStartIso);
    const thisWeekMinutes = thisWeekWorkouts.reduce(
      (sum, workout) => sum + getWorkoutDurationMinutes(workout.start_time, workout.end_time),
      0
    );
    const todayWorkoutCount = workouts.filter((workout) => workout.start_time.startsWith(today)).length;

    return {
      settings,
      goal,
      todayLogsCount: todayLogs.length,
      calorieTotals,
      workoutsCount: workouts.length,
      todayWorkoutCount,
      thisWeekWorkoutsCount: thisWeekWorkouts.length,
      thisWeekMinutes
    };
  }, [today, weekStartIso]);

  const calorieGoal = data?.goal?.calories_target ?? data?.settings?.nutrition?.calorieBudget ?? 2000;
  const proteinGoal =
    data?.goal?.protein_target ??
    Math.round((calorieGoal * ((data?.settings?.nutrition?.proteinPercent ?? 30) / 100)) / 4);
  const carbsGoal =
    data?.goal?.carbs_target ??
    Math.round((calorieGoal * ((data?.settings?.nutrition?.carbPercent ?? 40) / 100)) / 4);
  const fatGoal =
    data?.goal?.fat_target ??
    Math.round((calorieGoal * ((data?.settings?.nutrition?.fatPercent ?? 30) / 100)) / 9);

  const caloriesConsumed = Math.round(data?.calorieTotals.calories ?? 0);
  const proteinConsumed = Math.round(data?.calorieTotals.protein ?? 0);
  const carbsConsumed = Math.round(data?.calorieTotals.carbs ?? 0);
  const fatConsumed = Math.round(data?.calorieTotals.fat ?? 0);
  const calorieProgress = Math.min((caloriesConsumed / Math.max(1, calorieGoal)) * 100, 100);
  const proteinProgress = Math.min((proteinConsumed / Math.max(1, proteinGoal)) * 100, 100);
  const carbsProgress = Math.min((carbsConsumed / Math.max(1, carbsGoal)) * 100, 100);
  const fatProgress = Math.min((fatConsumed / Math.max(1, fatGoal)) * 100, 100);
  const macrosConfiguredCount = [proteinGoal, carbsGoal, fatGoal].filter((target) => target > 0).length;
  const extraGoalsCount = [
    data?.goal?.sleep_target,
    data?.goal?.water_target,
    data?.goal?.weight_target,
    data?.settings?.nutrition?.fiberGrams
  ].filter((value) => value !== undefined && value !== null && Number(value) > 0).length;

  return (
    <div className="min-h-screen bg-page pb-24 font-sans">
      <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
        <div className="max-w-md mx-auto px-4 py-3">
          <h1 className="text-2xl font-extrabold text-text-main">Dashboard</h1>
          <p className="text-xs text-text-muted mt-0.5">Today&apos;s overview across calories, workouts, and goals</p>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        <Link
          to="/log"
          className="block bg-card rounded-2xl p-6 border border-border-subtle shadow-sm hover:border-brand-light transition-all active:scale-[0.99]"
        >
          <p className="mt-2 text-3xl font-extrabold text-text-main">
            {caloriesConsumed} of {Math.round(calorieGoal)}{' '}
            <span className="text-sm font-semibold text-text-muted align-middle">Calories Eaten</span>
            <span className="ml-2 text-xs font-bold text-brand bg-surface px-2.5 py-1 rounded-full align-middle">
              {data?.todayLogsCount ?? 0} logs
            </span>
          </p>

          <div className="mt-3 h-4 bg-surface rounded-full overflow-hidden shadow-inner">
            <div
              className="h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-700 ease-out shadow-sm"
              style={{ width: `${calorieProgress}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-6 mt-6">
            <div className="text-center">
              <p className="text-xs text-text-muted mb-2 font-medium">Protein</p>
              <div className="relative h-2 bg-surface rounded-full mb-2">
                <div
                  className="absolute top-0 left-0 h-full bg-macro-protein rounded-full transition-all duration-500"
                  style={{ width: `${proteinProgress}%` }}
                />
              </div>
              <p className="text-xs font-bold text-text-main">{proteinConsumed} <span className="text-text-muted font-normal">/ {proteinGoal}g</span></p>
            </div>

            <div className="text-center">
              <p className="text-xs text-text-muted mb-2 font-medium">Carbs</p>
              <div className="relative h-2 bg-surface rounded-full mb-2">
                <div
                  className="absolute top-0 left-0 h-full bg-macro-carbs rounded-full transition-all duration-500"
                  style={{ width: `${carbsProgress}%` }}
                />
              </div>
              <p className="text-xs font-bold text-text-main">{carbsConsumed} <span className="text-text-muted font-normal">/ {carbsGoal}g</span></p>
            </div>

            <div className="text-center">
              <p className="text-xs text-text-muted mb-2 font-medium">Fat</p>
              <div className="relative h-2 bg-surface rounded-full mb-2">
                <div
                  className="absolute top-0 left-0 h-full bg-macro-fat rounded-full transition-all duration-500"
                  style={{ width: `${fatProgress}%` }}
                />
              </div>
              <p className="text-xs font-bold text-text-main">{fatConsumed} <span className="text-text-muted font-normal">/ {fatGoal}g</span></p>
            </div>
          </div>
        </Link>

        <Link
          to="/workouts"
          className="block bg-card rounded-2xl p-5 border border-border-subtle shadow-sm hover:border-brand-light transition-all active:scale-[0.99]"
        >
          <p className="text-sm font-bold uppercase tracking-wide text-text-muted">Workout</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="bg-surface rounded-xl p-2.5 text-center">
              <p className="text-2xl font-extrabold text-text-main">{data?.todayWorkoutCount ?? 0}</p>
              <p className="text-[11px] text-text-muted">Today</p>
            </div>
            <div className="bg-surface rounded-xl p-2.5 text-center">
              <p className="text-2xl font-extrabold text-text-main">{data?.thisWeekWorkoutsCount ?? 0}</p>
              <p className="text-[11px] text-text-muted">This week</p>
            </div>
            <div className="bg-surface rounded-xl p-2.5 text-center">
              <p className="text-2xl font-extrabold text-text-main">{data?.thisWeekMinutes ?? 0}</p>
              <p className="text-[11px] text-text-muted">Week mins</p>
            </div>
          </div>
          <p className="mt-3 text-xs font-medium text-text-muted">Total workouts logged: {data?.workoutsCount ?? 0}</p>
        </Link>

        <Link
          to="/profile"
          className="block bg-card rounded-2xl p-5 border border-border-subtle shadow-sm hover:border-brand-light transition-all active:scale-[0.99]"
        >
          <p className="text-sm font-bold uppercase tracking-wide text-text-muted">Different goals</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <p className="text-text-main font-bold bg-surface px-2.5 py-2 rounded-lg">Calorie: {Math.round(calorieGoal)} kcal</p>
            <p className="text-text-main font-bold bg-surface px-2.5 py-2 rounded-lg">Macros: {macrosConfiguredCount}</p>
            <p className="text-text-main font-bold bg-surface px-2.5 py-2 rounded-lg">Meals: {data?.settings?.meals?.length ?? 0}</p>
            <p className="text-text-main font-bold bg-surface px-2.5 py-2 rounded-lg">Extra: {extraGoalsCount}</p>
          </div>
          <p className="mt-3 text-xs font-medium text-text-muted">Tap to update nutrition, meals, reminders, and goal targets.</p>
        </Link>
      </main>
    </div>
  );
}