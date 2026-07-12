#!/usr/bin/env bash
#
# FireISP production redeploy: pull main, rebuild, migrate, verify — as one
# command, from any directory.
#
# Install once as a global command:
#     sudo install -m 0755 /opt/fireisp/redeploy.sh /usr/local/bin/redeploy
# then redeploy any time with:
#     sudo redeploy
#
# Non-standard install path? Override the directory:
#     FIREISP_DIR=/srv/fireisp redeploy
#
# `set -e` halts on the FIRST failed step, so a rejected pull or a broken build
# never goes on to migrate a stale/half-built image.
#
# NOTE: `up -d --build` can reuse Docker's cached compiled-frontend layer, so a
# merged FRONTEND change may not reach the browser. If that happens, force a
# clean rebuild per docs/deployment.md → "Updating to a new version":
#     docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache app
#     docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate app
#
set -euo pipefail

APP_DIR="${FIREISP_DIR:-/opt/fireisp}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
ENV_FILE="$APP_DIR/.env.prod"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "error: $COMPOSE_FILE not found — set FIREISP_DIR to your FireISP install path" >&2
  exit 1
fi

# Wrap the fully-qualified compose invocation so paths are quoted correctly.
dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "==> Updating source in $APP_DIR"
git -C "$APP_DIR" fetch origin
git -C "$APP_DIR" checkout main
git -C "$APP_DIR" pull --ff-only origin main

echo "==> Rebuilding and starting containers"
dc up -d --build

echo "==> Running database migrations"
dc exec app node src/scripts/migrate.js

echo "==> App container Node version"
dc exec app node -v

echo "==> Redeploy complete @ $(git -C "$APP_DIR" rev-parse --short HEAD)"
