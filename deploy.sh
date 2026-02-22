#!/bin/bash

set -euo pipefail

INCLUDE_ASSETS=false
SKIP_INSTALL=false
SKIP_MIGRATIONS=false
REQUIRE_MIGRATIONS=false
BACKUP_BEFORE_MIGRATIONS=false
BACKUP_LABEL=""

print_usage() {
    cat <<'EOF'
Usage: ./deploy.sh [options]

Options:
  --with-assets
      Include heavy workout media assets (audio/images/videos + media-map).
  --skip-install
      Skip npm install before build.
  --skip-migrations
      Skip DB migration upgrade step.
  --require-migrations
      Fail deploy if migration step cannot run (recommended for CI/prod).
  --backup-before-migrate
      Create DB backup before migration step.
  --backup-label=NAME
      Optional label suffix used by backup snapshot.
  -h, --help
      Show this help message and exit.

Examples:
  ./deploy.sh
  ./deploy.sh --skip-install
    ./deploy.sh --skip-migrations
    ./deploy.sh --require-migrations
    ./deploy.sh --backup-before-migrate --backup-label=release_candidate
  ./deploy.sh --with-assets
  ./deploy.sh --skip-install --with-assets
EOF
}

for arg in "$@"; do
    case "$arg" in
        --with-assets)
            INCLUDE_ASSETS=true
            ;;
        --skip-install)
            SKIP_INSTALL=true
            ;;
        --skip-migrations)
            SKIP_MIGRATIONS=true
            ;;
        --require-migrations)
            REQUIRE_MIGRATIONS=true
            ;;
        --backup-before-migrate)
            BACKUP_BEFORE_MIGRATIONS=true
            ;;
        --backup-label=*)
            BACKUP_LABEL="${arg#*=}"
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo
            print_usage
            exit 1
            ;;
    esac
done

if [ "$SKIP_MIGRATIONS" = true ] && [ "$REQUIRE_MIGRATIONS" = true ]; then
    echo "Error: --skip-migrations and --require-migrations cannot be used together."
    exit 1
fi

echo "Starting deployment..."

if [ "$SKIP_INSTALL" = false ]; then
    echo "Installing dependencies..."
    npm install
else
    echo "Skipping npm install (--skip-install)."
fi

if [ "$SKIP_MIGRATIONS" = false ]; then
    if [ "$BACKUP_BEFORE_MIGRATIONS" = true ]; then
        echo "Creating pre-migration database backup..."
        if [ -n "$BACKUP_LABEL" ]; then
            bash ./scripts/db/backup.sh --label="$BACKUP_LABEL"
        else
            bash ./scripts/db/backup.sh --label=predeploy
        fi
    fi

    if command -v supabase >/dev/null 2>&1; then
        echo "Applying database migrations (supabase db push)..."
        if ! npm run db:migrate:up; then
            if [ "$REQUIRE_MIGRATIONS" = true ]; then
                echo "Migration step failed and --require-migrations was provided."
                echo "Aborting deployment."
                exit 1
            fi

            echo "Migration step failed; continuing because strict mode is off."
            echo "Use --require-migrations to fail fast when migration cannot be applied."
        fi
    else
        if [ "$REQUIRE_MIGRATIONS" = true ]; then
            echo "Supabase CLI is not installed and --require-migrations was provided."
            echo "Aborting deployment."
            exit 1
        fi

        echo "Supabase CLI is not installed; skipping database migration step."
        echo "Install Supabase CLI to enable automatic schema upgrades during deploy."
        echo "Use --require-migrations to fail fast when migrations are skipped."
    fi
else
    echo "Skipping database migrations (--skip-migrations)."
fi

echo "Building the project..."
npm run build

if [ -d "build" ]; then
    BUILD_DIR="build"
elif [ -d "dist" ]; then
    BUILD_DIR="dist"
else
    echo "Error: Build directory not found. Expected 'build' or 'dist'."
    exit 1
fi

WORKTREE_DIR=".deploy-gh-pages"

has_worktree_gitdir() {
    [ -e "$WORKTREE_DIR/.git" ]
}

remove_stale_worktree_registration() {
    local worktrees_dir
    worktrees_dir="$(git rev-parse --git-path worktrees)"

    if [ -d "$worktrees_dir" ]; then
        for admin_dir in "$worktrees_dir"/*; do
            [ -d "$admin_dir" ] || continue
            local gitdir_file
            gitdir_file="$admin_dir/gitdir"
            [ -f "$gitdir_file" ] || continue

            local registered_gitdir
            registered_gitdir="$(cat "$gitdir_file")"

            if [ "$registered_gitdir" = "$WORKTREE_DIR/.git" ] || [ "$registered_gitdir" = "$(pwd)/$WORKTREE_DIR/.git" ]; then
                rm -rf "$admin_dir"
            fi
        done
    fi
}

cleanup() {
    if [ -d "$WORKTREE_DIR" ]; then
        if has_worktree_gitdir; then
            git worktree remove "$WORKTREE_DIR" --force || true
        else
            rm -rf "$WORKTREE_DIR"
            remove_stale_worktree_registration
            git worktree prune
        fi
    fi
}

trap cleanup EXIT

echo "Preparing gh-pages worktree..."
git fetch origin gh-pages || true

if [ -d "$WORKTREE_DIR" ] && ! has_worktree_gitdir; then
    echo "Removing stale/broken worktree at $WORKTREE_DIR..."
    rm -rf "$WORKTREE_DIR"
    remove_stale_worktree_registration
    git worktree prune
fi

if git show-ref --verify --quiet refs/remotes/origin/gh-pages; then
    git worktree add -B gh-pages "$WORKTREE_DIR" origin/gh-pages
else
    echo "gh-pages branch does not exist yet. Initializing it..."
    git worktree add "$WORKTREE_DIR"
    (
        cd "$WORKTREE_DIR"
        git checkout --orphan gh-pages
        git rm -rf . >/dev/null 2>&1 || true
        git commit --allow-empty -m "Initialize gh-pages"
        git push origin gh-pages
    )
fi

echo "Syncing $BUILD_DIR to gh-pages..."

RSYNC_ARGS=(
    -a
    --delete
    --exclude ".git"
    --exclude ".git/"
)

if [ "$INCLUDE_ASSETS" = false ]; then
    echo "Skipping heavy workout assets (use --with-assets to include them)."
    RSYNC_ARGS+=(
        --exclude "workouts/audio/***"
        --exclude "workouts/images/***"
        --exclude "workouts/videos/***"
        --exclude "workouts/media-map.json"
    )
fi

rsync "${RSYNC_ARGS[@]}" "$BUILD_DIR/" "$WORKTREE_DIR/"

(
    cd "$WORKTREE_DIR"
    > .nojekyll
    git add -A

    if git diff --cached --quiet; then
        echo "No changes to deploy."
        exit 0
    fi

    git commit -m "Deploy to gh-pages"
    git push origin gh-pages
)

echo "Deployment complete!"