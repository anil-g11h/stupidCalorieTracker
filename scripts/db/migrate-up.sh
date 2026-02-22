#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

resolve_project_ref() {
  if [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
    echo "$SUPABASE_PROJECT_REF"
    return
  fi

  local env_file="$ROOT_DIR/.env"
  if [ -f "$env_file" ]; then
    local value
    value="$(grep -E '^SUPABASE_PROJECT_REF=' "$env_file" | tail -n 1 | cut -d '=' -f 2- || true)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    echo "$value"
    return
  fi

  echo ""
}

PROJECT_REF="$(resolve_project_ref)"

if [ -n "$PROJECT_REF" ]; then
  echo "Linking Supabase project ($PROJECT_REF) for migration apply..."
  if ! supabase link --project-ref "$PROJECT_REF" --yes >/dev/null; then
    echo "Warning: auto-link failed. Falling back to current Supabase CLI context."
  fi
fi

supabase db push "$@"
