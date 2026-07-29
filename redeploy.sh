#!/usr/bin/env bash
#
# FireISP production redeploy: pull main, pull the matching image, migrate,
# verify — as one command, from any directory.
#
# Install once as a global command:
#     sudo install -m 0755 /opt/fireisp/redeploy.sh /usr/local/bin/redeploy
# then redeploy any time with:
#     sudo redeploy
#
# Roll back to an earlier build (see "ROLLBACK" below):
#     sudo redeploy <commit-sha>
#
# NOTHING IS COMPILED HERE. CI builds, scans and publishes the image
# (.github/workflows/ci.yml → container-scan); this pulls it. That is the whole
# point: the in-image frontend build peaks around 1.43 GB RSS, and running it on
# the host while the stack was live evicted MySQL's buffer pools into swap. The
# evicted pages never came back, so swap ratcheted up with every deploy until
# the box thrashed hard enough to lock out SSH and need a reboot.
#
# The image is pinned to the EXACT commit being deployed, so `docker ps` and
# `git rev-parse HEAD` can never disagree.
#
# ROLLBACK — pass the target commit as an ARGUMENT, not an environment variable:
#
#     sudo redeploy 1a2b3c4
#
# `sudo` resets the environment by default (`Defaults env_reset` in sudoers), so
# a `VAR=x sudo redeploy` prefix is SILENTLY DISCARDED — the script would then
# fall through to HEAD and redeploy the newest build, i.e. the exact thing you
# were rolling back from, while exiting 0. The argument form cannot be stripped.
# FIREISP_IMAGE_TAG still works when the environment genuinely survives (running
# as root without sudo, or `sudo -E` with a SETENV sudoers tag).
#
# NOTE ON SCHEMA: rolling the image back does NOT roll the database back.
# Migrations already applied stay applied, and migrate.js below no-ops because
# the old image only knows its own (already-applied) files. Old code against a
# forward schema is fine for additive migrations and breaks on a DROP, RENAME or
# narrowed ENUM — check what the deploy you are undoing actually migrated.
#
# Non-standard install path? Set it in the environment of a ROOT shell (not as a
# sudo prefix, for the reason above):
#     sudo -i; FIREISP_DIR=/srv/fireisp redeploy
#
# `set -e` halts on the FIRST failed step, so a rejected pull or a missing image
# never goes on to migrate against a stale container.
#
set -euo pipefail

APP_DIR="${FIREISP_DIR:-/opt/fireisp}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
ENV_FILE="$APP_DIR/.env.prod"
REGISTRY_IMAGE="${FIREISP_REGISTRY_IMAGE:-ghcr.io/vothalvino/fireisp5.0}"
# How many superseded images to keep on disk for rollback. Everything older is
# removed after a successful deploy — see "Reclaiming" at the end.
KEEP_IMAGES="${FIREISP_IMAGE_KEEP:-3}"

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

# Precedence: positional argument, then FIREISP_IMAGE_TAG, then the commit just
# checked out. The argument comes first because it is the only form that
# survives `sudo`.
TAG="${1:-${FIREISP_IMAGE_TAG:-$(git -C "$APP_DIR" rev-parse HEAD)}}"
export FIREISP_IMAGE="${REGISTRY_IMAGE}:${TAG}"
echo "==> Target image $FIREISP_IMAGE"
if [[ -n "${1:-}" ]]; then
  echo "    (pinned by argument — this is a ROLLBACK; the database schema is NOT rolled back)"
fi

echo "==> Pulling image"
if ! dc pull app; then
  cat >&2 <<EOF

error: could not pull ${FIREISP_IMAGE}

  Three likely reasons:

  1. 'denied' / 'unauthorized' — the ghcr package is PRIVATE and this host is
     not logged in. GitHub makes container packages private by DEFAULT, even
     for a public repository, so this bites once on a new install and never
     again. Either make the package public (GitHub → Packages → fireisp5.0 →
     Package settings → Change visibility), or authenticate here:

         echo "\$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin

  2. 'manifest unknown' — no image exists for this commit. Either CI has not
     finished (it publishes only AFTER the Trivy scan passes), or the build was
     SKIPPED because Docker Hub was unreachable. That case leaves the CI run
     GREEN with a warning annotation, so a green tick is not proof an image
     exists — open the run and check container-scan for "Container scan
     SKIPPED". If so, re-run that job, or deploy the previous commit:

         sudo redeploy <previous-commit-sha>

         https://github.com/vothalvino/fireisp5.0/actions

  3. 'no matching manifest for linux/arm64' — the published image is amd64
     only. On an ARM host, build locally instead:

         cd ${APP_DIR} && docker compose -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env.prod up -d --build

  Nothing has been changed on this host: the previous containers are still
  running and still serving.

EOF
  exit 1
fi

echo "==> Starting containers"
dc up -d

# Wait for the new container to answer before migrating. Without this, a
# crash-looping image fails at `exec` with a bare "container is not running",
# which reads like a tooling problem rather than a bad deploy. The old
# build-based flow got this cover accidentally, from the minutes it spent
# compiling; pulling is fast enough that the race is now real.
echo "==> Waiting for the app to become responsive"
for _i in $(seq 1 30); do
  if dc exec -T app node -e 'process.exit(0)' >/dev/null 2>&1; then break; fi
  sleep 2
done
if ! dc exec -T app node -e 'process.exit(0)' >/dev/null 2>&1; then
  echo "error: the app container is not running 60s after start — migrations NOT applied." >&2
  echo "       Inspect with: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs --tail=100 app" >&2
  echo "       Roll back with: sudo redeploy <previous-commit-sha>" >&2
  exit 1
fi

echo "==> Running database migrations"
dc exec app node src/scripts/migrate.js

echo "==> App container Node version"
dc exec app node -v

# Reclaim superseded images. `docker image prune` is NOT enough here: it removes
# only DANGLING (untagged) images, and every image this script pulls carries a
# unique :<sha> tag, so nothing is ever dangling and a plain prune is inert. The
# retained set would otherwise grow by one image per deploy forever — which is
# what makes dockerd/containerd hold ever more resident metadata, and why the
# interval between "the box got stuck" kept shrinking.
#
# Keep the newest KEEP_IMAGES tagged builds (rollback targets) and drop the rest.
# Never touch :latest, and never use `prune -a`, which would evict the very
# images a rollback needs.
echo "==> Reclaiming superseded images (keeping $KEEP_IMAGES)"
docker images --filter "reference=${REGISTRY_IMAGE}" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | sort -r \
  | cut -f2 \
  | grep -v ':latest$' \
  | grep -vF ":${TAG}" \
  | tail -n "+${KEEP_IMAGES}" \
  | while read -r old; do
      docker rmi "$old" >/dev/null 2>&1 && echo "    removed $old" || true
    done
# Dangling layers can still appear (e.g. an interrupted pull), so this stays.
docker image prune -f >/dev/null 2>&1 || true

echo "==> Redeploy complete @ $(git -C "$APP_DIR" rev-parse --short HEAD) (image $TAG)"
