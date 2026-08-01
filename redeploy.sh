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
# Seconds to wait for the image to appear before giving up. The dominant
# "failure" is redeploying in the few minutes between merging and CI finishing
# the publish, which is not a failure at all — it is a race worth waiting out.
# 0 disables the wait and fails immediately.
IMAGE_WAIT="${FIREISP_IMAGE_WAIT:-600}"

# -----------------------------------------------------------------------------
# Settings this script may INTRODUCE into an existing .env.prod
# -----------------------------------------------------------------------------
# An upgrade that needs the operator to hand-edit a secrets file is an upgrade
# most operators will not perform. New options therefore arrive in .env.prod on
# the next deploy, already carrying their default and their explanation, so
# turning one on is editing a line that is in front of you rather than knowing
# a variable name exists.
#
# AN EXPLICIT ALLOWLIST, NEVER "every key in .env.prod.example". That file
# carries PLACEHOLDER SECRETS — DB_PASSWORD=CHANGE_ME_strong_db_password,
# ENCRYPTION_KEY=CHANGE_ME_64_char_random_hex_string. Introducing one of those
# into a working install would lock out the database, or make every stored CSD
# and payment credential undecryptable. Only inert, non-secret settings with a
# default that preserves current behaviour belong here.
#
# Format: KEY=default|one-line explanation written into the file as a comment.
MANAGED_ENV_KEYS=(
  "FIREISP_UPDATE_CHECK=0|Show the install operator a once-a-day banner when a newer FireISP release exists. Set to 1 to enable. OFF by default: this is the only outbound request FireISP makes on its own behalf (an unauthenticated read of the newest public commit). No install data, version or identifiers are sent."
)

# Append any managed setting the operator's .env.prod does not already mention.
#
# Rules that make this safe to run against a live secrets file:
#   * APPEND ONLY. No existing line is ever rewritten, reordered or removed, so
#     a chosen value cannot be reverted by a later deploy.
#   * A key counts as present whether it is SET or COMMENTED OUT. Someone who
#     deliberately commented a setting out has expressed an intent, and a deploy
#     that silently re-added it would be overriding them.
#   * A backup is taken before the first write of each run.
#   * Unwritable or missing file: skip with a note. Never fail the deploy over a
#     cosmetic setting.
sync_managed_env() {
  local env_file="$1"
  local added=0 backed_up=0 entry key default comment

  [[ -f "$env_file" ]] || { echo "    (no $env_file — skipping settings sync)"; return 0; }

  for entry in "${MANAGED_ENV_KEYS[@]}"; do
    key="${entry%%=*}"
    default="${entry#*=}"; default="${default%%|*}"
    comment="${entry#*|}"

    # Present in any form — set, or commented out on purpose.
    if grep -qE "^[[:space:]]*#?[[:space:]]*${key}=" "$env_file"; then
      continue
    fi

    if [[ ! -w "$env_file" ]]; then
      echo "    (cannot write $env_file — add ${key}=${default} by hand to use it)" >&2
      return 0
    fi

    if (( ! backed_up )); then
      cp -p "$env_file" "${env_file}.bak-$(date +%Y%m%d-%H%M%S)"
      backed_up=1
    fi

    # A file not ending in a newline would otherwise have the new key glued to
    # the end of the last line — which for a secrets file means corrupting the
    # value above it.
    #
    # Belt and braces: the block below already opens with a newline, so today
    # this line changes nothing and mutating it away is an EQUIVALENT mutant
    # (confirmed — the test suite cannot distinguish it, correctly). It stays
    # because it is the only thing protecting that invariant if the separator
    # is ever dropped from the printf below.
    [[ -n "$(tail -c1 "$env_file")" ]] && printf '\n' >>"$env_file"

    {
      printf '\n# %s\n' "$comment"
      printf '%s=%s\n' "$key" "$default"
    } >>"$env_file"
    echo "    + added ${key}=${default}"
    added=$(( added + 1 ))
  done

  if (( added )); then
    echo "    ${added} new setting(s) written to $env_file (backup alongside it)"
  fi
}

# Sourced by tests to get the functions above without running a deploy.
if [[ "${FIREISP_LIB_ONLY:-}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

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

# -----------------------------------------------------------------------------
# Wait for the image by RETRYING THE REAL PULL, then diagnose one cause.
# -----------------------------------------------------------------------------
# Merging and immediately redeploying is a race, not an error: CI publishes only
# after the security scan passes. So the pull is retried until the deadline
# rather than failing on the first attempt.
#
# It retries `dc pull` itself rather than probing with `docker manifest
# inspect`. Probing meant classifying a DIFFERENT command's error text, and
# GHCR makes that unreliable in the one way that matters:
#
#   GHCR answers 401 "unauthorized" for a tag that does not exist, not 404.
#
# So a not-yet-published image is indistinguishable from a private package by
# message alone. Keying the wait off that text skipped the wait exactly when it
# was needed, and then reported "your package is private" — wrong twice.
# Retrying the real operation removes the guesswork: the thing being retried is
# the thing that has to succeed.
#
# Waiting is bounded and side-effect free, so retrying an error that turns out
# to be permanent costs one wait and then reports honestly.
STAY_MSG="  Nothing has been changed on this host: the previous containers are still
  running and still serving."

echo "==> Syncing new settings into $(basename "$ENV_FILE")"
sync_managed_env "$ENV_FILE"

echo "==> Pulling image"
PULL_OUT="$(dc pull app 2>&1)" && PULL_OK=1 || PULL_OK=0

if (( ! PULL_OK )) && (( IMAGE_WAIT > 0 )); then
  case "$PULL_OUT" in
    # Permanent conditions: waiting cannot make the image match this CPU, and
    # cannot free disk. Everything else is retried, because GHCR's wording
    # cannot tell "not published yet" from "private".
    *"no matching manifest"*|*"no match for platform"*|*"no space left on device"*) ;;
    *)
      echo "==> Not pullable yet — retrying for up to ${IMAGE_WAIT}s"
      echo "    (CI publishes only after the security scan passes, so a commit"
      echo "     merged moments ago takes several minutes to become deployable)"
      deadline=$(( SECONDS + IMAGE_WAIT ))
      while (( SECONDS < deadline )); do
        sleep 15
        printf '    ...retrying (%ds elapsed)\n' "$(( IMAGE_WAIT - (deadline - SECONDS) ))"
        if PULL_OUT="$(dc pull app 2>&1)"; then PULL_OK=1; break; fi
      done
      (( PULL_OK )) && echo "==> Image published — continuing"
      ;;
  esac
fi

if (( ! PULL_OK )); then
  printf '%s\n' "$PULL_OUT" >&2
  echo >&2
  echo "error: could not pull ${FIREISP_IMAGE}" >&2
  echo >&2
  case "$PULL_OUT" in
    *"no matching manifest"*|*"no match for platform"*)
      cat >&2 <<EOF
  The image exists but not for this machine's architecture. Published builds
  are linux/amd64 and linux/arm64, which covers every mainstream VPS. On
  anything else (32-bit ARM, RISC-V), build from source instead:

      cd ${APP_DIR} && docker compose -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env.prod up -d --build
EOF
      ;;
    *nauthorized*|*denied*|*"authentication required"*|*"manifest unknown"*|*"no such manifest"*|*"not found"*)
      cat >&2 <<EOF
  Two causes look identical here, because GHCR answers 401 "unauthorized" for a
  tag that does not exist rather than 404. After waiting ${IMAGE_WAIT}s, in
  order of likelihood:

  1. No image for this commit yet. CI publishes only after the security scan
     passes. The container-scan job is also allowed to go GREEN WITHOUT
     BUILDING when Docker Hub is unreachable, so a green tick is not proof an
     image exists -- open the run and look for "Container scan SKIPPED".

         https://github.com/vothalvino/fireisp5.0/actions

     Wait longer, or deploy the last commit that does have an image:

         FIREISP_IMAGE_WAIT=1800 sudo -E redeploy
         sudo redeploy <previous-commit-sha>

  2. The ghcr package is private and this host is not logged in. GitHub makes
     container packages private by DEFAULT even for a public repository, so
     this bites once on a new install and never again. Make the package public
     (GitHub -> Packages -> fireisp5.0 -> Package settings -> Change
     visibility), or authenticate:

         echo "\$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin
EOF
      ;;
    *"no space left on device"*)
      cat >&2 <<EOF
  The host is out of disk. Retained images are the usual cause -- this script
  keeps ${KEEP_IMAGES} for rollback and prunes the rest, but only after a
  SUCCESSFUL deploy, so a run of failures lets them accumulate.

      df -h ${APP_DIR}
      docker system df          # where the space actually went
      docker builder prune -f   # build cache only -- keeps every image

  To keep fewer rollback targets, lower FIREISP_IMAGE_KEEP (currently
  ${KEEP_IMAGES}) and run a successful deploy; the prune step then reclaims the
  rest. Do NOT reach for a blanket image prune: it deletes the older builds that
  make \`sudo redeploy <sha>\` a one-step rollback.
EOF
      ;;
    *)
      cat >&2 <<EOF
  The pull failed for a reason this script does not recognise -- the registry
  output is above. Worth checking disk and connectivity:

      df -h ${APP_DIR}
EOF
      ;;
  esac
  echo >&2
  echo "$STAY_MSG" >&2
  echo >&2
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
