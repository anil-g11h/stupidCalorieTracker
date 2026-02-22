#!/bin/bash

set -euo pipefail

INPUT=""
DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
CONFIRM=false

print_usage() {
  cat <<'EOF'
Usage: bash ./scripts/db/restore.sh --from=<backup-dir-or-full.dump> [options]

Options:
  --from=PATH       Backup directory or .dump file.
  --db-url=URL      Postgres connection string (overrides env).
  --yes             Required safety switch to execute restore.
  -h, --help        Show this help message.

Environment fallback:
  SUPABASE_DB_URL or DATABASE_URL

Restore order:
  1) full.dump via pg_restore (preferred), or
  2) schema.sql then data.sql via psql.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --from=*)
      INPUT="${arg#*=}"
      ;;
    --db-url=*)
      DB_URL="${arg#*=}"
      ;;
    --yes)
      CONFIRM=true
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      print_usage
      exit 1
      ;;
  esac
done

if [ -z "$INPUT" ]; then
  echo "Missing --from argument."
  print_usage
  exit 1
fi

if [ -z "$DB_URL" ]; then
  echo "Missing database URL. Set SUPABASE_DB_URL (or DATABASE_URL) or pass --db-url=."
  exit 1
fi

if [ "$CONFIRM" != true ]; then
  echo "Restore is destructive. Re-run with --yes to confirm."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not found in PATH."
  exit 1
fi

if [ -d "$INPUT" ]; then
  DUMP_FILE="$INPUT/full.dump"
  SCHEMA_FILE="$INPUT/schema.sql"
  DATA_FILE="$INPUT/data.sql"
else
  DUMP_FILE="$INPUT"
  SCHEMA_FILE=""
  DATA_FILE=""
fi

if [ -f "$DUMP_FILE" ]; then
  if ! command -v pg_restore >/dev/null 2>&1; then
    echo "pg_restore is required for .dump restores but not found in PATH."
    exit 1
  fi

  echo "Restoring from $DUMP_FILE"
  pg_restore \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --dbname "$DB_URL" \
    "$DUMP_FILE"

  echo "Restore complete."
  exit 0
fi

if [ -f "$SCHEMA_FILE" ] && [ -f "$DATA_FILE" ]; then
  echo "Restoring schema from $SCHEMA_FILE"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SCHEMA_FILE"

  echo "Restoring data from $DATA_FILE"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$DATA_FILE"

  echo "Restore complete."
  exit 0
fi

echo "Could not find restorable files in: $INPUT"
exit 1
