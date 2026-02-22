# Database Structure Guide

## Layout

- `schema.sql` — baseline schema snapshot for fresh project bootstrap.
- `migrations/` — ordered schema/data evolution scripts for deployments.
- `seeds/workouts/` — generated workout exercise reference seeds.
- `functions/` — Supabase Edge Functions.

## Operational Workflow

1. Create migration: `npm run db:migrate:create -- <name>`
2. Apply migration: `npm run db:migrate:up`
3. Regenerate workout seeds (if media map changes):
   - `npm run seed:workouts:sql`
   - `npm run seed:workouts:sql:upsert`

## Risky Deployment Safety

- Create backup snapshot: `npm run db:backup -- --label=pre_release`
- Deploy with backup + migrations: `npm run deploy -- --backup-before-migrate --backup-label=pre_release`
- Restore if needed: `npm run db:restore -- --from=backups/db/<timestamp>_pre_release --yes`

## Rollback Model

This project uses forward-only migrations in production.
If a migration causes issues, create a new forward-fix migration and apply it.
