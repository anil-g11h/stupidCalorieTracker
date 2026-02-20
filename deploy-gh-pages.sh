# Exit on error
set -e

BUILD_DIR="build"
PREV_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ ! -d "$BUILD_DIR" ]; then
  echo "Build output not found. Run 'npm run build' first."
  exit 1
fi

git checkout gh-pages

# Remove all files except .git and deploy-gh-pages.sh
# find . -mindepth 1 -maxdepth 1 ! -name '.git' ! -name 'deploy-gh-pages.sh' -exec rm -rf {} +

# Copy build output to root
gcp -r $BUILD_DIR/* .

# Always create .nojekyll file in root for GitHub Pages
> .nojekyll

git add .
git commit -m "Deploy static site for StupidCaloriesTracker (build only)"
git push origin gh-pages --force

git checkout $PREV_BRANCH
echo "Deployment complete! Switched back to $PREV_BRANCH."

