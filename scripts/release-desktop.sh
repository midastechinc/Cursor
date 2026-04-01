#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install jq and retry."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install gh and retry."
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/release-desktop.sh <patch|minor|major|x.y.z> [release notes]"
  exit 1
fi

VERSION_BUMP="$1"
RELEASE_NOTES="${2:-Desktop release}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes first."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  echo "Releases should be created from main/master. Current branch: $CURRENT_BRANCH"
  exit 1
fi

CURRENT_VERSION="$(jq -r '.version' package.json)"

if [[ "$VERSION_BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VERSION="$VERSION_BUMP"
  npm version "$NEW_VERSION" --no-git-tag-version >/dev/null
else
  npm version "$VERSION_BUMP" --no-git-tag-version >/dev/null
  NEW_VERSION="$(jq -r '.version' package.json)"
fi

echo "Version bumped: $CURRENT_VERSION -> $NEW_VERSION"

npm install >/dev/null
npm run desktop:build

TAG="v$NEW_VERSION"

git add package.json package-lock.json
git commit -m "Release $TAG"
git push origin "$CURRENT_BRANCH"

git tag "$TAG"
git push origin "$TAG"

ARTIFACTS=(release/*.exe release/latest*.yml release/*.blockmap)

gh release create "$TAG" "${ARTIFACTS[@]}" \
  --repo "midastechinc/Cursor" \
  --title "$TAG" \
  --notes "$RELEASE_NOTES"

echo "Release created: $TAG"
