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
# Non-standard install path? Override the directory:
#     FIREISP_DIR=/srv/fireisp redeploy
#
# NOTHING IS COMPILED HERE. CI builds, scans and publishes the image
# (.github/workflows/ci.yml → container-scan); this pulls it. That is the whole
# point: the in-image frontend build peaks around 1.43 GB RSS, and running it on
# the host while the stack was live evicted MySQL's buffer pools into swap. The
# evicted pages never came back, so swap ratcheted up with every deploy until
# the box thrashed hard enough to lock out SSH and need a reboot.
#
# The image is pinned to the EXACT commit being deployed, so `docker ps` and
# `git rev-parse HEAD` can never disagree, and a rollback is a tag change:
#     FIREISP_IMAGE_TAG=<older-sha> redeploy
#
# `set -e` halts on the FIRST failed step, so a rejected pull or a missing image
# never goes on to migrate against a stale container.
#
set -euo pipefail

APP_DIR="${FIREISP_DIR:-/opt/fireisp}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
ENV_FILE="$APP_DIR/.env.prod"
REGISTRY_IMAGE="${FIREISP_REGISTRY_IMAGE:-ghcr.io/vothalvino/fireisp5.0}"

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

# The compose file, migrations-on-disk and this script come from git; the
# RUNNING CODE comes from the image. Pinning the tag to the commit we just
# checked out is what keeps those two in step.
TAG="${FIREISP_IMAGE_TAG:-$(git -C "$APP_DIR" rev-parse HEAD)}"
export FIREISP_IMAGE="${REGISTRY_IMAGE}:${TAG}"
echo "==> Target image $FIREISP_IMAGE"

echo "==> Pulling image"
if ! dc pull app; then
  cat >&2 <<EOF

error: could not pull ${FIREISP_IMAGE}

  Two likely reasons:

  1. CI has not finished publishing this commit yet — the image is pushed only
     after the Trivy scan passes on main. Check:

         https://github.com/vothalvino/fireisp5.0/actions

  2. The ghcr package is PRIVATE and this host is not logged in. GitHub makes
     container packages private by DEFAULT, even for a public repository, so
     this bites once on a new install and never again. Either make the package
     public (GitHub → Packages → fireisp5.0 → Package settings → Change
     visibility), or authenticate here with a read:packages token:

         echo "\$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin

     A 'denied' or 'unauthorized' in the error above means this one.

  Then re-run \`redeploy\`. Nothing has been changed on this host: the previous
  containers are still running and still serving.

  To deploy a specific earlier build instead (rollback):

      FIREISP_IMAGE_TAG=<commit-sha> redeploy

EOF
  exit 1
fi

echo "==> Starting containers"
dc up -d

echo "==> Running database migrations"
dc exec app node src/scripts/migrate.js

echo "==> App container Node version"
dc exec app node -v

# Reclaim the images this deploy superseded. Without it every deploy leaves a
# full image behind: the layer store grows by roughly 350 MB a time, and — the
# part that actually bites — dockerd/containerd hold resident metadata for every
# image and layer they still know about, so the interval between wedges shrinks
# deploy over deploy. A reboot clears that metadata but never the disk, which is
# exactly why rebooting used to "fix" it while the real total kept climbing.
#
# Untagged (dangling) images only: never `-a`, which would evict images still
# referenced by a tag, including the one you would roll back to.
echo "==> Reclaiming superseded images"
docker image prune -f >/dev/null 2>&1 || echo "  (prune skipped — non-fatal)"

echo "==> Redeploy complete @ $(git -C "$APP_DIR" rev-parse --short HEAD) (image $TAG)"
