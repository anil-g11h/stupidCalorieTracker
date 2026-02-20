#!/bin/bash

# Exit on error
set -e

BUILD_DIR="build"
TEMP_DIR="../temp-client"
PREV_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ ! -d "$BUILD_DIR" ]; then
  echo "Build output not found. Run 'npm run build' first."
  exit 1
fi

git checkout gh-pages

mkdir -p "$TEMP_DIR"
cp -r $BUILD_DIR/* $TEMP_DIR/

find . -mindepth 1 -maxdepth 1 ! -name '.git' ! -name 'deploy-gh-pages.sh' ! -name "$TEMP_DIR" -exec rm -rf {} +

cp -r $TEMP_DIR/* .
rm -rf $TEMP_DIR

git add .
git commit -m "Deploy static site for StupidCaloriesTracker (safe copy)"
git push origin gh-pages --force

git checkout $PREV_BRANCH
echo "Deployment complete! Switched back to $PREV_BRANCH."
