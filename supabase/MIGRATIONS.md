# Supabase Migration Playbook

This project uses a **migration-first** SQL workflow.

## Goals

- Keep schema changes small, reviewable, and reversible.
- Make every migration safe to run once in production.
- Separate schema evolution from one-off data seeding.
- Support future changes without editing old migrations.

## File Naming

Use timestamped, ordered filenames:

- Preferred: `YYYYMMDDHHMM_<scope>_<change>.sql`
- Example: `202602211430_foods_add_fiber_column.sql`

Current repository files already use `YYYYMMDD_<change>.sql`; continue that style if you want, but include time when creating multiple migrations in one day.

## Migration Structure (inside each SQL file)

Write sections in this order:

1. **Pre-checks** (optional)
   - Guard assumptions using safe checks.
2. **DDL changes**
   - `create table/column/index`, `alter table`, `drop` with `if exists` / `if not exists`.
3. **Data backfill**
   - Deterministic `update`/`insert` statements to make old rows compatible with new schema.
4. **Constraints & defaults**
   - Add `not null`, `check`, `unique` only after backfill.
5. **RLS and grants**
   - `alter table ... enable row level security` and policy updates.
6. **Post-change validation queries** (commented)
   - Add small `select` sanity checks for manual verification.

## Authoring Rules

- Never modify an old migration after it has been applied to shared environments.
- Prefer additive changes first; destructive changes should be split into multiple migrations.
- Use `drop policy if exists` before `create policy` when replacing policies.
- Avoid long table locks when possible (split large updates into guarded steps).
- Keep one concern per migration (schema, policy, or focused backfill).
- Do not place bulk seed datasets in migrations.

## Data Seeding Policy

- Seed scripts and generated seed SQL files are intentionally removed from this repository.
- If reference data is required in production, model it as a migration-safe, idempotent **reference-data migration** with explicit keys and `on conflict` handling.
- If data is only for local/dev experiments, keep it outside versioned migrations.

## Query Patterns to Prefer

- Idempotent DDL:
  - `alter table ... add column if not exists ...`
  - `create index if not exists ...`
- Idempotent upsert for reference data:
  - `insert ... on conflict (...) do update ...`
- Guarded backfill:
  - `update ... set ... where new_column is null`

## Rollout Checklist (for every new migration)

- Migration name is timestamped and descriptive.
- SQL is idempotent where practical.
- Backfill runs before strict constraints.
- Policies are dropped/recreated safely.
- Manual validation queries are included.
- README/docs updated when behavior changes.

## Suggested Future Layout

Keep using `supabase/migrations/` as the single source of truth.

Optional convention for readability:

- `*_schema_*.sql` for table/column changes
- `*_policy_*.sql` for RLS changes
- `*_backfill_*.sql` for data compatibility fixes

This keeps query intent clear while preserving execution order by timestamp.
