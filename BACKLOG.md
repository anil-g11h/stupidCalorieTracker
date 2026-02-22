# Backlog

Last updated: 2026-02-21

## Prioritization rubric
- **Priority**: P0 (urgent), P1 (high), P2 (medium), P3 (later)
- **Impact**: High / Medium / Low user or engineering impact
- **Effort**: S (1-2 days), M (3-7 days), L (1-3 weeks)

---

## Product Ideas

### P0

#### 1) Adaptive Meal Planner
- **Type**: Product
- **Impact**: High
- **Effort**: M
- **Why**: Existing goals/settings/foods model can generate practical plans quickly.
- **Scope**:
  - Generate a daily meal plan from calorie + macro targets
  - Respect dietary tags/allergies/preferences
  - Convert plan to log entries with one tap
- **Acceptance criteria**:
  - User can generate a full day plan in <5 seconds
  - Plan is within ±10% calories and ±10% per macro target
  - At least 80% of proposed meals pass dietary/allergy filters
- **Dependencies**: `foods`, `goals`, `settings`, dietary profile rules

#### 2) Goal Drift Alerts (Weekly)
- **Type**: Product
- **Impact**: High
- **Effort**: S
- **Why**: Improves adherence using existing metrics and logs.
- **Scope**:
  - Weekly trend checks for calories, protein, workouts, hydration
  - Actionable nudges (“You’re 18% below protein target this week”)
- **Acceptance criteria**:
  - Weekly check runs reliably on app open
  - Alert copy includes gap + next action
  - User can mute per category
- **Dependencies**: Home/Log aggregates, reminders settings

### P1

#### 3) Workout Progression Coach
- **Type**: Product
- **Impact**: High
- **Effort**: L
- **Why**: Workout history and set data can drive personalized progression.
- **Scope**:
  - Show previous performance per exercise
  - Suggest next target (weight/reps/time) per metric type
  - Plateau detection over last 4-6 sessions
- **Acceptance criteria**:
  - Suggestions available for >=90% exercises with history
  - Users can apply suggestion in one tap
  - Plateau warning appears when progression stalls by defined threshold
- **Dependencies**: workout sessions, sets, metric type mapping

#### 4) Recovery Readiness Score
- **Type**: Product
- **Impact**: Medium
- **Effort**: M
- **Why**: Uses existing sleep/water/workout load data for daily guidance.
- **Scope**:
  - Compute daily score from sleep, hydration, recent workout duration
  - Show score card + recommendation (push/hard/easy/rest)
- **Acceptance criteria**:
  - Score explains factors that increased/decreased it
  - Recommendation updates when new data is logged
- **Dependencies**: metrics table (`sleep`, `water`), workouts

### P2

#### 5) Smart Grocery List from Plans/Recipes
- **Type**: Product
- **Impact**: Medium
- **Effort**: M
- **Why**: Increases retention and complements recipe + planner features.
- **Scope**:
  - Aggregate ingredients from selected recipes/meal plan
  - Group by category and estimate quantities
  - Mark as bought
- **Acceptance criteria**:
  - List generation supports mixed recipes + direct foods
  - Quantity aggregation avoids duplicate ingredients
- **Dependencies**: `food_ingredients`, recipe model, planner

#### 6) Natural Language Quick Log v1
- **Type**: Product
- **Impact**: Medium
- **Effort**: M
- **Why**: Faster logging path likely improves DAU and completion rates.
- **Scope**:
  - Parse simple text (“2 eggs and toast”) into candidate foods
  - Confirm-and-save UI with editable quantities
- **Acceptance criteria**:
  - Parses common single-meal prompts with >=70% top-1 correctness
  - Edit + save takes <=3 taps after parsing
- **Dependencies**: food search, optional Gemini edge function

---

## Technical Debt

### P0

#### 1) Add Engineering Guardrails (Lint + Tests + CI gates)
- **Type**: Tech Debt
- **Impact**: High
- **Effort**: M
- **Why**: Current repo lacks lint/test safety net for large refactors.
- **Scope**:
  - Add ESLint + TypeScript rules
  - Add Vitest + React Testing Library baseline
  - CI workflow for `typecheck`, `lint`, `test`, `build`
- **Acceptance criteria**:
  - PRs fail on lint/type/test/build errors
  - At least 1 test per critical flow (sync, add-log, workout set update)

#### 2) Resolve Stack Drift (React vs legacy Svelte artifacts)
- **Type**: Tech Debt
- **Impact**: High
- **Effort**: M
- **Why**: Mixed-framework residue increases confusion and onboarding cost.
- **Scope**:
  - Decide source of truth framework for runtime paths
  - Remove/archive unused Svelte routes or document hybrid architecture
  - Align README/deploy workflow naming and publish directory
- **Acceptance criteria**:
  - One clear architecture statement in docs
  - No dead routes/config accidentally shipped
  - Deploy workflow references actual build output

### P1

#### 3) Decompose Large Files into Feature Modules
- **Type**: Tech Debt
- **Impact**: High
- **Effort**: L
- **Why**: Very large components hinder safe iteration.
- **Scope**:
  - Split Home, Log, AddLog, WorkoutSession, SyncManager into hooks/services/components
  - Create folder conventions (`feature/hooks`, `feature/components`, `feature/services`)
- **Acceptance criteria**:
  - Target <350 LOC per module (with justified exceptions)
  - New modules have unit tests for business logic
  - No behavior regressions in key user flows

#### 4) Remove `any` and `@ts-ignore` in Sync + Workout Domain
- **Type**: Tech Debt
- **Impact**: High
- **Effort**: M
- **Why**: Type escapes in sync/workouts are high-risk for data issues.
- **Scope**:
  - Introduce typed queue item payloads by table/action
  - Replace dynamic casts in `sync.ts`, `useWorkoutSession.ts`, `WorkoutSession.tsx`
- **Acceptance criteria**:
  - Zero `@ts-ignore` in sync/workout modules
  - Strict TypeScript passes without suppressions for touched files

#### 5) Data Access Boundary (Repository Layer)
- **Type**: Tech Debt
- **Impact**: Medium
- **Effort**: M
- **Why**: Direct Dexie/Supabase calls from UI make logic hard to test.
- **Scope**:
  - Add repositories for foods/logs/workouts/settings/sync queue
  - Move query and transaction logic out of route components
- **Acceptance criteria**:
  - UI components consume repository/service methods only
  - Business logic testable without rendering components

### P2

#### 6) Sync Observability + Error Taxonomy
- **Type**: Tech Debt
- **Impact**: Medium
- **Effort**: S
- **Why**: Sync failures are hard to diagnose without structured diagnostics.
- **Scope**:
  - Standardize error codes + metadata for push/pull failures
  - Add minimal telemetry hooks and local debug panel
- **Acceptance criteria**:
  - Each failed queue item has a category + retry reason
  - Debug view shows pending queue, last sync time, last error

#### 7) Schema/Model Contract Validation
- **Type**: Tech Debt
- **Impact**: Medium
- **Effort**: M
- **Why**: Offline-first schema drift can silently break sync.
- **Scope**:
  - Add runtime schema validation (zod or lightweight validators)
  - Validate incoming/outgoing sync payloads
- **Acceptance criteria**:
  - Invalid payloads fail fast with actionable error context
  - Validation enabled for all sync tables

---

## Suggested execution order (next 6 weeks)
1. Engineering guardrails (lint/test/CI)
2. Stack drift cleanup and documentation alignment
3. Type hardening in sync + workouts
4. File decomposition of top 3 hotspots
5. Ship Adaptive Meal Planner MVP
6. Ship Goal Drift Alerts

## Icebox / revisit later
- Food photo logging
- Social challenges / accountability groups
- Wearable integrations
