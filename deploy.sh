#!/bin/bash

set -euo pipefail

INCLUDE_ASSETS=false
SKIP_INSTALL=false

for arg in "$@"; do
    case "$arg" in
        --with-assets)
            INCLUDE_ASSETS=true
            ;;
        --skip-install)
            SKIP_INSTALL=true
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Usage: ./deploy.sh [--with-assets] [--skip-install]"
            exit 1
            ;;
    esac
done

echo "Starting deployment..."

if [ "$SKIP_INSTALL" = false ]; then
    echo "Installing dependencies..."
    npm install
else
    echo "Skipping npm install (--skip-install)."
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

cleanup() {
    if git worktree list | grep -q "$WORKTREE_DIR"; then
        git worktree remove "$WORKTREE_DIR" --force
    fi
}

trap cleanup EXIT

echo "Preparing gh-pages worktree..."
git fetch origin gh-pages || true

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