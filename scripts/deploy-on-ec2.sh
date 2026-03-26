#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PROJECT_PATH:-}" ]]; then
  echo "PROJECT_PATH is required"
  exit 1
fi

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

cd "$PROJECT_PATH"

echo "Deploying branch '$DEPLOY_BRANCH' in $PROJECT_PATH"

git fetch origin "$DEPLOY_BRANCH"
git checkout "$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"

if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "Deployment finished successfully"
