import React from 'react';
import { MEAL_PATTERN_OPTIONS, type DietaryPreferences } from '../../../lib/dietaryProfile';
import {
  type FastingWindowHint,
  formatDurationHours,
  IF_16_8_EATING_WINDOW_GOAL_HOURS,
  type MealSetting,
  type MealTargetMode,
  type MealTimingAdvice
} from '../mealPlanning';
import { type AdaptiveMealPlan } from '../adaptiveMealPlanner';
import { Field, OptionCard } from './ProfileSectionPrimitives';

const toNonNegativeNumber = (value: number, fallback = 0) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

const round1 = (value: number) => Math.round(value * 10) / 10;

function PlannerMetric({ label, value, isGood }: { label: string; value: string; isGood: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-muted font-bold">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-text-main">{value}</div>
        <span className={`text-[10px] font-bold ${isGood ? 'text-brand' : 'text-text-muted'}`}>
          {isGood ? '✓ ±10%' : 'Adjust'}
        </span>
      </div>
    </div>
  );
}

function AdaptiveMealPlanCard({ plan }: { plan: AdaptiveMealPlan }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <PlannerMetric
          label="Calories"
          value={`${round1(plan.summary.plannedCalories)} / ${round1(plan.summary.targetCalories)}`}
          isGood={plan.summary.caloriesWithin10Percent}
        />
        <PlannerMetric
          label="Protein (g)"
          value={`${round1(plan.summary.plannedProtein)} / ${round1(plan.summary.targetProtein)}`}
          isGood={plan.summary.proteinWithin10Percent}
        />
        <PlannerMetric
          label="Carbs (g)"
          value={`${round1(plan.summary.plannedCarbs)} / ${round1(plan.summary.targetCarbs)}`}
          isGood={plan.summary.carbsWithin10Percent}
        />
        <PlannerMetric
          label="Fat (g)"
          value={`${round1(plan.summary.plannedFat)} / ${round1(plan.summary.targetFat)}`}
          isGood={plan.summary.fatWithin10Percent}
        />
      </div>

      <div className="text-xs rounded-xl px-3 py-2 border bg-surface border-border-subtle text-text-main">
        <span className="font-semibold">Dietary filter pass rate:</span> {round1(plan.dietaryPassRate)}%
      </div>

      <div className="space-y-2">
        {plan.meals.map((meal) => (
          <div key={meal.mealId} className="rounded-xl border border-border-subtle bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-text-main">{meal.mealName}</div>
              <div className="text-[11px] text-text-muted">{meal.mealTime}</div>
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              {meal.items.map((item) => `${item.foodName} × ${round1(item.quantity)}`).join(' + ')}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              {round1(meal.totals.calories)} cal • P {round1(meal.totals.protein)}g • C {round1(meal.totals.carbs)}g • F {round1(meal.totals.fat)}g
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FastingWindowCard({ hint }: { hint: FastingWindowHint }) {
  return (
    <div
      className={`text-xs rounded-xl px-3 py-2 border ${
        hint.exceedsGoal
          ? 'bg-macro-fat/10 border-macro-fat/30 text-text-main'
          : 'bg-brand/10 border-brand/30 text-text-main'
      }`}
    >
      {hint.exceedsGoal ? (
        <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-macro-fat/20 px-2 py-0.5 text-[11px] font-semibold text-text-main">
          <span>⚠</span>
          <span>Eating window exceeds 16:8 goal</span>
        </div>
      ) : (
        <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-semibold text-text-main">
          <span>✓</span>
          <span>Eating window within goal</span>
        </div>
      )}
      <div>
        Eating window: {hint.eatingStart} - {hint.eatingEnd} ({formatDurationHours(hint.eatingHours)}) • Fasting: {formatDurationHours(hint.fastingHours)}
      </div>
      <div className="mt-1 text-text-muted">
        For 16:8, keep meal times within about an {IF_16_8_EATING_WINDOW_GOAL_HOURS}-hour eating window.
      </div>
    </div>
  );
}

function MealTimingAdviceCard({ advice }: { advice: MealTimingAdvice }) {
  return (
    <div className="text-xs bg-surface border border-border-subtle rounded-xl px-3 py-2 text-text-main">
      <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-semibold">
        <span>💡</span>
        <span>Timing advice ({advice.score}/100)</span>
      </div>
      <div className="text-text-muted">{advice.summary}</div>
      <div className="mt-1">• {advice.advice}</div>
    </div>
  );
}

function MealRow({
  meal,
  mealInputMode,
  dailyCalorieBudget,
  onUpdateMeal,
  onRemoveMeal
}: {
  meal: MealSetting;
  mealInputMode: MealTargetMode;
  dailyCalorieBudget: number;
  onUpdateMeal: (mealId: string, patch: Partial<MealSetting>) => void;
  onRemoveMeal: (mealId: string) => void;
}) {
  const budget = toNonNegativeNumber(dailyCalorieBudget, 0);
  const percentValue = toNonNegativeNumber(meal.targetValue, 0);
  const calorieValue = round1((percentValue / 100) * budget);

  return (
    <div className="bg-surface border border-border-subtle rounded-xl p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_84px] items-center gap-2">
        <div className="min-w-0 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-text-main truncate">{meal.name || 'Meal'}</span>
          <button
            type="button"
            onClick={() => onRemoveMeal(meal.id)}
            className="h-6 w-6 rounded-md border border-border-subtle bg-card text-text-muted hover:text-text-main text-xs font-bold leading-none"
            aria-label={`Remove ${meal.name || 'meal'}`}
            title="Remove meal"
          >
            ×
          </button>
        </div>

        <input
          type="time"
          value={meal.time}
          onChange={(e) => onUpdateMeal(meal.id, { time: e.target.value })}
          className="w-full p-1.5 rounded-lg border border-border-subtle bg-card text-text-main text-xs"
          aria-label={`${meal.name || 'Meal'} time`}
        />

        <input
          type="number"
          min="0"
          value={percentValue}
          onChange={(e) => {
            if (mealInputMode !== 'percent') return;
            onUpdateMeal(meal.id, { targetValue: Number(e.target.value) });
          }}
          disabled={mealInputMode !== 'percent'}
          className="w-full p-1.5 rounded-lg border border-border-subtle bg-card text-text-main text-xs text-right disabled:opacity-60"
          aria-label={`${meal.name || 'Meal'} target percent`}
        />

        <input
          type="number"
          min="0"
          value={calorieValue}
          onChange={(e) => {
            if (mealInputMode !== 'calories') return;
            const calories = toNonNegativeNumber(Number(e.target.value), 0);
            const nextPercent = budget > 0 ? round1((calories / budget) * 100) : 0;
            onUpdateMeal(meal.id, { targetValue: nextPercent });
          }}
          disabled={mealInputMode !== 'calories'}
          className="w-full p-1.5 rounded-lg border border-border-subtle bg-card text-text-main text-xs text-right disabled:opacity-60"
          aria-label={`${meal.name || 'Meal'} target calories`}
        />
      </div>
    </div>
  );
}

export function MealsSection({
  isOpen,
  onToggle,
  dietaryForm,
  setDietaryForm,
  onMealPatternSelected,
  fastingWindowHint,
  mealTimingAdvice,
  addMeal,
  meals,
  sortedMeals,
  mealInputMode,
  setMealInputMode,
  dailyCalorieBudget,
  totalMealPercent,
  totalMealCalories,
  canSaveSettings,
  adaptiveMealPlan,
  adaptiveMealPlanError,
  isGeneratingAdaptiveMealPlan,
  isApplyingAdaptiveMealPlan,
  generateAdaptiveMealPlanForToday,
  applyAdaptiveMealPlanToToday,
  onRemoveMeal,
  onUpdateMeal
}: {
  isOpen: boolean;
  onToggle: () => void;
  dietaryForm: DietaryPreferences;
  setDietaryForm: React.Dispatch<React.SetStateAction<DietaryPreferences>>;
  onMealPatternSelected: (pattern: string) => void;
  fastingWindowHint: FastingWindowHint | null;
  mealTimingAdvice: MealTimingAdvice | null;
  addMeal: () => void;
  meals: MealSetting[];
  sortedMeals: MealSetting[];
  mealInputMode: MealTargetMode;
  setMealInputMode: React.Dispatch<React.SetStateAction<MealTargetMode>>;
  dailyCalorieBudget: number;
  totalMealPercent: number;
  totalMealCalories: number;
  canSaveSettings: boolean;
  adaptiveMealPlan: AdaptiveMealPlan | null;
  adaptiveMealPlanError: string | null;
  isGeneratingAdaptiveMealPlan: boolean;
  isApplyingAdaptiveMealPlan: boolean;
  generateAdaptiveMealPlanForToday: () => Promise<void>;
  applyAdaptiveMealPlanToToday: () => Promise<void>;
  onRemoveMeal: (mealId: string) => void;
  onUpdateMeal: (mealId: string, patch: Partial<MealSetting>) => void;
}) {
  return (
    <OptionCard
      title="Meals"
      subtitle="Name, time, and target split per meal"
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <div className="space-y-4">
        <Field label="Meal pattern">
          <select
            value={dietaryForm.mealPattern}
            onChange={(e) => {
              const selectedPattern = e.target.value;
              setDietaryForm((prev) => ({ ...prev, mealPattern: selectedPattern }));
              onMealPatternSelected(selectedPattern);
            }}
            className="w-full p-2.5 rounded-xl border border-border-subtle bg-surface text-text-main text-sm"
          >
            <option value="">Select meal pattern</option>
            {MEAL_PATTERN_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {fastingWindowHint && <FastingWindowCard hint={fastingWindowHint} />}
        {mealTimingAdvice && <MealTimingAdviceCard advice={mealTimingAdvice} />}

        <button
          type="button"
          onClick={addMeal}
          className="px-3 py-1.5 rounded-full text-xs font-bold bg-surface text-text-muted hover:text-text-main border border-border-subtle transition-colors"
        >
          Add Meal
        </button>

        <div className="space-y-3">
          {meals.length === 0 ? (
            <div className="text-center py-6 bg-surface rounded-xl border border-border-subtle">
              <p className="text-sm text-text-muted">No meals configured.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_84px] gap-2 px-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Meal</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted text-right pr-1">Time</span>
                <div className="col-span-2 h-6 rounded-lg border border-border-subtle bg-surface relative overflow-hidden">
                  <div
                    className={`absolute top-0 bottom-0 w-1/2 rounded-md bg-brand transition-transform ${
                      mealInputMode === 'calories' ? 'translate-x-full' : 'translate-x-0'
                    }`}
                  />
                  <div className="relative z-10 grid grid-cols-2 h-full">
                    <button
                      type="button"
                      onClick={() => setMealInputMode('percent')}
                      className={`text-[10px] font-bold uppercase tracking-wide ${
                        mealInputMode === 'percent' ? 'text-brand-fg' : 'text-text-muted'
                      }`}
                    >
                      % Target
                    </button>
                    <button
                      type="button"
                      onClick={() => setMealInputMode('calories')}
                      className={`text-[10px] font-bold uppercase tracking-wide ${
                        mealInputMode === 'calories' ? 'text-brand-fg' : 'text-text-muted'
                      }`}
                    >
                      Calories
                    </button>
                  </div>
                </div>
              </div>

              {sortedMeals.map((meal) => (
                <MealRow
                  key={meal.id}
                  meal={meal}
                  mealInputMode={mealInputMode}
                  dailyCalorieBudget={dailyCalorieBudget}
                  onRemoveMeal={onRemoveMeal}
                  onUpdateMeal={onUpdateMeal}
                />
              ))}
            </>
          )}
        </div>

        <div className="pt-1">
          <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_84px] gap-2 px-2 items-center">
            <span className="text-sm font-bold text-text-main">Daily calorie budget</span>
            <span />
            <span className="text-sm font-bold text-text-main text-right">{round1(totalMealPercent)}%</span>
            <span className="text-sm font-bold text-text-main text-right">{round1(totalMealCalories)} Cal</span>
          </div>
          {!canSaveSettings && (
            <p className="text-xs text-text-muted mt-1">
              Warning: Meal totals must equal 100% and {dailyCalorieBudget} Cal to save settings.
            </p>
          )}
        </div>

        <div className="pt-2 border-t border-border-subtle space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-text-main">Adaptive Meal Planner</h4>
              <p className="text-xs text-text-muted">Generate a full-day plan from your calorie/macro and dietary settings.</p>
            </div>
            <button
              type="button"
              onClick={generateAdaptiveMealPlanForToday}
              disabled={isGeneratingAdaptiveMealPlan}
              className="px-3 py-1.5 rounded-full text-xs font-bold bg-brand text-brand-fg hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {isGeneratingAdaptiveMealPlan ? 'Generating...' : 'Generate Plan'}
            </button>
          </div>

          {adaptiveMealPlanError ? (
            <div className="text-xs rounded-xl px-3 py-2 border bg-macro-fat/10 border-macro-fat/30 text-text-main">
              {adaptiveMealPlanError}
            </div>
          ) : null}

          {adaptiveMealPlan ? (
            <>
              <AdaptiveMealPlanCard plan={adaptiveMealPlan} />
              <button
                type="button"
                onClick={applyAdaptiveMealPlanToToday}
                disabled={isApplyingAdaptiveMealPlan}
                className="w-full py-2.5 rounded-xl bg-surface text-text-main border border-border-subtle text-sm font-bold hover:bg-card transition-colors disabled:opacity-60"
              >
                {isApplyingAdaptiveMealPlan ? 'Adding to log...' : 'Add Plan to Today\'s Log'}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </OptionCard>
  );
}
