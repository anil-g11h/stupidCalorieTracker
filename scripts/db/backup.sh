#!/bin/bash

set -euo pipefail

BACKUP_ROOT="backups/db"
LABEL=""
DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"

print_usage() {
  cat <<'EOF'
Usage: bash ./scripts/db/backup.sh [options]

Options:
  --db-url=URL      Postgres connection string (overrides env).
  --label=NAME      Optional label suffix for backup folder.
  --out-dir=PATH    Backup root directory (default: backups/db).
  -h, --help        Show this help message.

Environment fallback:
  SUPABASE_DB_URL or DATABASE_URL

Output files:
  <backup-dir>/full.dump     (pg_dump custom format)
  <backup-dir>/schema.sql    (schema-only SQL)
  <backup-dir>/data.sql      (data-only SQL)
  <backup-dir>/meta.txt      (metadata)
EOF
}

for arg in "$@"; do
  case "$arg" in
    --db-url=*)
      DB_URL="${arg#*=}"
      ;;
    --label=*)
      LABEL="${arg#*=}"
      ;;
    --out-dir=*)
      BACKUP_ROOT="${arg#*=}"
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

if [ -z "$DB_URL" ]; then
  echo "Missing database URL. Set SUPABASE_DB_URL (or DATABASE_URL) or pass --db-url=."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but not found in PATH."
  echo "Install PostgreSQL client tools (e.g. brew install libpq && brew link --force libpq)."
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SAFE_LABEL="${LABEL//[^a-zA-Z0-9._-]/_}"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
if [ -n "$SAFE_LABEL" ]; then
  BACKUP_DIR="${BACKUP_DIR}_${SAFE_LABEL}"
fi

mkdir -p "$BACKUP_DIR"

echo "Creating full backup at $BACKUP_DIR/full.dump"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$BACKUP_DIR/full.dump" \
  "$DB_URL"

echo "Creating schema backup at $BACKUP_DIR/schema.sql"
pg_dump \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file "$BACKUP_DIR/schema.sql" \
  "$DB_URL"

echo "Creating data backup at $BACKUP_DIR/data.sql"
pg_dump \
  --data-only \
  --inserts \
  --column-inserts \
  --no-owner \
  --no-privileges \
  --file "$BACKUP_DIR/data.sql" \
  "$DB_URL"

cat > "$BACKUP_DIR/meta.txt" <<EOF
created_at_utc=$TIMESTAMP
label=$SAFE_LABEL
backup_dir=$BACKUP_DIR
source=postgres
EOF

echo "Backup completed: $BACKUP_DIR"
