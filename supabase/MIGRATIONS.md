# Supabase Migration Playbook

This project uses a **migration-first** SQL workflow.

For folder layout and operational scripts, see `supabase/DB_STRUCTURE.md`.

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

- Workout exercise reference data is seeded from static assets using `npm run seed:workouts:sql`.
- Generated output is written to `supabase/seeds/workouts/seed_workout_exercises.wipe.sql`.
- If additional reference data is required in production, model it as a migration-safe, idempotent **reference-data migration** with explicit keys and `on conflict` handling.
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

## CLI Workflow

Use Supabase CLI from repo root:

```bash
# Create migration
npm run db:migrate:create -- add_profile_locale

# Review migration status
npm run db:migrate:status

# Apply pending migrations
npm run db:migrate:up
```

`db:migrate:status` and `db:migrate:up` auto-link using `SUPABASE_PROJECT_REF` (from environment or `.env`) when available.

Supabase records migration history in `supabase_migrations.schema_migrations`.

## Rollback Strategy

Production rollback uses a **forward-fix migration**:

- Do not edit already-applied migration files.
- Create a new migration that reverses the bad change.
- Apply it with `npm run db:migrate:up`.

For risky releases, take a DB snapshot immediately before deploying:

```bash
npm run db:backup -- --label=pre_release
```

If deployment goes wrong, restore from snapshot using:

```bash
npm run db:restore -- --from=backups/db/<timestamp>_pre_release --yes
```

This gives fast recovery while keeping the migration model strictly forward-only.

## Suggested Future Layout

Keep using `supabase/migrations/` as the single source of truth.

Optional convention for readability:

- `*_schema_*.sql` for table/column changes
- `*_policy_*.sql` for RLS changes
- `*_backfill_*.sql` for data compatibility fixes

This keeps query intent clear while preserving execution order by timestamp.
