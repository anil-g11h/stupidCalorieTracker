import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import Auth from '../../lib/components/Auth';
import RouteHeader from '../../lib/components/RouteHeader';
import { NutritionSection } from './components/NutritionSection';
import { DietarySection } from './components/DietarySection';
import { MealsSection } from './components/MealsSection';
import { RemindersSection } from './components/RemindersSection';
import { REMINDER_KEYS, useProfileSettings } from './useProfileSettings';

export default function ProfileSettings() {
  const {
    session,
    loading,
    saving,
    openSection,
    setOpenSection,
    mealInputMode,
    setMealInputMode,
    macroTrackRef,
    draggingMacroHandle,
    setDraggingMacroHandle,
    form,
    dietaryForm,
    setDietaryForm,
    customAllergyInput,
    setCustomAllergyInput,
    macroFirstCut,
    macroSecondCut,
    proteinGramsDisplay,
    carbGramsDisplay,
    fatGramsDisplay,
    totalMealPercent,
    totalMealCalories,
    canSaveSettings,
    fastingWindowHint,
    mealTimingAdvice,
    sortedMeals,
    updateNutrition,
    addMeal,
    onMealPatternSelected,
    updateMeal,
    removeMeal,
    updateReminder,
    toggleDietTag,
    toggleAllergy,
    toggleMedicalConstraint,
    addCustomAllergy,
    removeCustomAllergy,
    adaptiveMealPlan,
    adaptiveMealPlanError,
    isGeneratingAdaptiveMealPlan,
    isApplyingAdaptiveMealPlan,
    generateAdaptiveMealPlanForToday,
    applyAdaptiveMealPlanToToday,
    saveAllSettings
  } = useProfileSettings();

  if (loading) {
    return <div className="p-10 text-center text-text-muted">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-page pb-24">
        <RouteHeader title="Profile" />
        <div className="px-4 max-w-md mx-auto mt-8">
          <div className="bg-card p-5 rounded-2xl border border-border-subtle">
            <h2 className="text-base font-bold text-text-main mb-3">Sign in</h2>
            <Auth />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page pb-24">
      <RouteHeader
        title="Profile Settings"
        rightAction={
          <button
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-surface text-text-muted hover:text-text-main border border-border-subtle transition-colors"
            onClick={() => supabase.auth.signOut()}
          >
            Sign Out
          </button>
        }
      />

      <main className="max-w-md mx-auto p-4 space-y-5">
        <form onSubmit={saveAllSettings} className="space-y-5">
          <NutritionSection
            isOpen={openSection === 'nutrition'}
            onToggle={() => setOpenSection((prev) => (prev === 'nutrition' ? null : 'nutrition'))}
            nutrition={form.nutrition}
            updateNutrition={updateNutrition}
            macroTrackRef={macroTrackRef}
            draggingMacroHandle={draggingMacroHandle}
            macroFirstCut={macroFirstCut}
            macroSecondCut={macroSecondCut}
            setDraggingMacroHandle={setDraggingMacroHandle}
            proteinGramsDisplay={proteinGramsDisplay}
            carbGramsDisplay={carbGramsDisplay}
            fatGramsDisplay={fatGramsDisplay}
          />

          <DietarySection
            isOpen={openSection === 'dietary'}
            onToggle={() => setOpenSection((prev) => (prev === 'dietary' ? null : 'dietary'))}
            dietaryForm={dietaryForm}
            setDietaryForm={setDietaryForm}
            customAllergyInput={customAllergyInput}
            setCustomAllergyInput={setCustomAllergyInput}
            toggleDietTag={toggleDietTag}
            toggleAllergy={toggleAllergy}
            toggleMedicalConstraint={toggleMedicalConstraint}
            addCustomAllergy={addCustomAllergy}
            removeCustomAllergy={removeCustomAllergy}
          />

          <MealsSection
            isOpen={openSection === 'meals'}
            onToggle={() => setOpenSection((prev) => (prev === 'meals' ? null : 'meals'))}
            dietaryForm={dietaryForm}
            setDietaryForm={setDietaryForm}
            onMealPatternSelected={onMealPatternSelected}
            fastingWindowHint={fastingWindowHint}
            mealTimingAdvice={mealTimingAdvice}
            addMeal={addMeal}
            meals={form.meals}
            sortedMeals={sortedMeals}
            mealInputMode={mealInputMode}
            setMealInputMode={setMealInputMode}
            dailyCalorieBudget={form.nutrition.calorieBudget}
            totalMealPercent={totalMealPercent}
            totalMealCalories={totalMealCalories}
            canSaveSettings={canSaveSettings}
            adaptiveMealPlan={adaptiveMealPlan}
            adaptiveMealPlanError={adaptiveMealPlanError}
            isGeneratingAdaptiveMealPlan={isGeneratingAdaptiveMealPlan}
            isApplyingAdaptiveMealPlan={isApplyingAdaptiveMealPlan}
            generateAdaptiveMealPlanForToday={generateAdaptiveMealPlanForToday}
            applyAdaptiveMealPlanToToday={applyAdaptiveMealPlanToToday}
            onRemoveMeal={removeMeal}
            onUpdateMeal={updateMeal}
          />

          <RemindersSection
            isOpen={openSection === 'reminders'}
            onToggle={() => setOpenSection((prev) => (prev === 'reminders' ? null : 'reminders'))}
            reminderKeys={REMINDER_KEYS}
            reminders={form.reminders}
            updateReminder={updateReminder}
          />

          {canSaveSettings ? (
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 rounded-xl bg-brand text-brand-fg font-black text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          ) : null}
        </form>

      </main>
    </div>
  );
}