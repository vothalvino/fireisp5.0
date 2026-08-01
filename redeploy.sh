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
# Install/refresh the systemd units for the GUI deploy agent as part of every
# deploy. 0 disables it entirely for an operator who would rather not have a
# timer on the box.
#
# The opt-out is read from .env.prod because that is the only place that
# survives `sudo`: sudoers' env_reset strips a `FIREISP_DEPLOY_AGENT=0 sudo
# redeploy` prefix silently — the same trap the rollback argument exists for —
# so the docs point operators at the file. A value in the real environment
# still wins when one genuinely survives (root shell, `sudo -E` with SETENV).
# Only an explicit 0 is honoured; quotes, CRLF and a trailing comment are
# tolerated because the file is hand-edited.
if [[ -z "${FIREISP_DEPLOY_AGENT:-}" && -f "$ENV_FILE" ]]; then
  _flag="$( (grep -E '^[[:space:]]*(export[[:space:]]+)?FIREISP_DEPLOY_AGENT[[:space:]]*=' "$ENV_FILE" || true) \
    | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]*#.*$//' | tr -d '\r"'"'"' \t' )"
  # `if`, not `[[ ]] &&` — under set -e a false && at top level kills the script.
  if [[ "$_flag" == "0" ]]; then FIREISP_DEPLOY_AGENT=0; fi
  unset _flag
fi
DEPLOY_AGENT="${FIREISP_DEPLOY_AGENT:-1}"

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
  # (none currently — see MANAGED_ENV_RETIRE below for FIREISP_UPDATE_CHECK)
)

# Settings this script may REMOVE from an existing .env.prod.
#
# The counterpart to the list above: when a setting's default flips, installs
# that received the OLD default explicitly are pinned to it, and would need the
# hand-edit the sync exists to avoid.
#
# ONLY a line that still exactly equals the default WE wrote is removed. If the
# operator changed the value, that is a decision and it stands — this can never
# overwrite a choice, only withdraw a suggestion nobody acted on. Removing the
# line rather than rewriting it leaves the file identical to a fresh install's.
#
# A value match alone is NOT enough to prove we wrote the line: an operator who
# typed `FIREISP_UPDATE_CHECK=0` by hand produces a byte-identical line, and
# withdrawing that would re-enable something they deliberately switched off.
# So the comment block we wrote alongside it must also be there. An operator's
# own line has no such comment and is left completely alone.
#
# Format: KEY=old-default|marker in our comment|why it is being withdrawn.
MANAGED_ENV_RETIRE=(
  "FIREISP_UPDATE_CHECK=0|once-a-day banner|the update check is now ON by default, so the line we previously added would pin this install to the old default"
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

    # Present in any form — set, commented out on purpose, `export`-prefixed,
    # or spaced around the `=`. compose-go's dotenv parser accepts all of these
    # (it has an explicit export-prefix rule and trims whitespace before `=`),
    # and so does `set -a; source .env.prod`. Missing one of them is not
    # cosmetic: the key looks absent, a second definition gets appended, and
    # because the parser builds its map sequentially THE LATER ONE WINS —
    # silently reverting the value the operator chose, and leaving the file
    # holding two contradictory definitions.
    if grep -qE "^[[:space:]]*#?[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$env_file"; then
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

# Withdraw a managed setting whose default has changed, when the operator never
# touched the value we suggested.
#
# This is the ONE place this script removes a line from .env.prod, so the
# constraints are tighter than for appending:
#   * The line must match `KEY=old-default` EXACTLY (grep -qxF). Any edit by the
#     operator — including whitespace — makes it theirs, and it is left alone.
#   * The contiguous comment block above it goes too, since that is what we
#     wrote alongside it; an orphaned comment explaining an absent key is worse
#     than either.
#   * The file is rewritten by TRUNCATING THE ORIGINAL (`> "$env_file"`), never
#     by mv-ing a temp file over it. mv would replace the inode and hand the
#     file the temp's permissions — turning a 0600 secrets file into whatever
#     the umask says, which is a silent credential exposure.
#   * A non-empty result is required before writing. An awk failure must not be
#     able to blank a file containing DB_PASSWORD and ENCRYPTION_KEY.
retire_managed_env() {
  local env_file="$1"
  local entry key rest oldval marker cleaned backed_up=0

  [[ -f "$env_file" ]] || return 0

  for entry in "${MANAGED_ENV_RETIRE[@]}"; do
    key="${entry%%=*}"
    rest="${entry#*=}"
    oldval="${rest%%|*}"
    marker="${rest#*|}"; marker="${marker%%|*}"

    grep -qxF "${key}=${oldval}" "$env_file" || continue
    # Proof we wrote it. Without this the operator's own opt-out is undone.
    grep -qF "$marker" "$env_file" || {
      echo "    (leaving ${key}=${oldval} alone — set by hand, not by this script)"
      continue
    }

    if [[ ! -w "$env_file" ]]; then
      echo "    (cannot write $env_file — remove the line ${key}=${oldval} by hand)" >&2
      continue
    fi

    cleaned="$(awk -v target="${key}=${oldval}" '
      { lines[NR] = $0 }
      END {
        t = 0
        for (i = 1; i <= NR; i++) if (lines[i] == target) { t = i; break }
        if (t == 0) { for (i = 1; i <= NR; i++) print lines[i]; exit }
        s = t
        while (s > 1 && lines[s-1] ~ /^[[:space:]]*#/) s--
        if (s > 1 && lines[s-1] ~ /^[[:space:]]*$/) s--
        for (i = 1; i <= NR; i++) if (i < s || i > t) print lines[i]
      }
    ' "$env_file")" || continue

    [[ -n "$cleaned" ]] || {
      echo "    (skipped retiring ${key} — refusing to write an empty $env_file)" >&2
      continue
    }

    if (( ! backed_up )); then
      cp -p "$env_file" "${env_file}.bak-$(date +%Y%m%d-%H%M%S)"
      backed_up=1
    fi

    printf '%s\n' "$cleaned" > "$env_file"
    echo "    - withdrew ${key}=${oldval} (default changed; backup alongside)"
  done
}

# -----------------------------------------------------------------------------
# Keep the GUI deploy agent installed and current
# -----------------------------------------------------------------------------
# The units used to be a four-command manual step in the docs, which meant the
# Update button only worked for someone who had read them — and, worse, that a
# FIX to the agent never reached anyone who had installed it, because the
# install copied the script somewhere redeploy does not touch. Both of those
# were real: the agent shipped naming a compose service that does not exist, and
# the copy would have kept failing the same way after the fix landed.
#
# So the deploy installs its own units, the same way it applies its own
# migrations. This script already runs as root and already restarts the whole
# stack; writing two unit files that run a script from this same checkout is
# well inside that envelope, and adds no authority the deploy did not have.
#
# Idempotent and quiet: the files are compared before writing, and systemd is
# only reloaded when something actually changed. A host without systemd, or
# without root, is skipped with a note rather than failing the deploy.
install_deploy_agent() {
  local unit src dst changed=0

  [[ "$DEPLOY_AGENT" != "0" ]] || { echo "    (FIREISP_DEPLOY_AGENT=0 — skipping)"; return 0; }
  command -v systemctl >/dev/null 2>&1 || { echo "    (no systemctl on this host — GUI deploys unavailable, CLI unaffected)"; return 0; }
  [[ -w /etc/systemd/system ]] || { echo "    (need root to install the units — run via sudo to enable GUI deploys)" >&2; return 0; }

  for unit in fireisp-deploy-agent.service fireisp-deploy-agent.timer; do
    src="$APP_DIR/deploy/$unit"
    dst="/etc/systemd/system/$unit"
    [[ -f "$src" ]] || continue
    # cmp, not cp: rewriting an identical file every deploy would churn systemd
    # and restart the timer for nothing.
    if ! cmp -s "$src" "$dst"; then
      install -m 0644 "$src" "$dst"
      echo "    + ${unit}"
      changed=1
    fi
  done

  if (( changed )); then
    systemctl daemon-reload
  fi
  # enable --now is idempotent, and is what picks the agent up on a host where
  # it was never installed at all.
  systemctl enable --now fireisp-deploy-agent.timer >/dev/null 2>&1 || {
    echo "    (could not enable the timer — see: systemctl status fireisp-deploy-agent.timer)" >&2
    return 0
  }
  if (( changed )); then
    systemctl restart fireisp-deploy-agent.timer
    echo "    units updated and timer restarted"
  else
    echo "    already current"
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

echo "==> Deploy agent"
install_deploy_agent

echo "==> Syncing new settings into $(basename "$ENV_FILE")"
sync_managed_env "$ENV_FILE"
retire_managed_env "$ENV_FILE"

echo "==> Pulling image"
PULL_OUT="$(dc pull app 2>&1)" && PULL_OK=1 || PULL_OK=0

# A ROLLBACK must never wait. `sudo redeploy <sha>` is the emergency path, run
# when production is already broken — and CI only ever publishes the full 40-hex
# sha, `-amd64`/`-arm64` and `:latest`, so an abbreviated or mistyped tag does
# not exist and never will. Retrying it burns the full FIREISP_IMAGE_WAIT
# (600s by default) of `sleep 15` before failing, which is ten minutes of
# outage spent waiting for something that cannot arrive. Waiting only makes
# sense for HEAD, where CI genuinely is still publishing.
if [[ -n "${1:-}" ]] && (( ! PULL_OK )); then
  echo "    (pinned tag — not retrying: a rollback target either exists or does not)" >&2
elif (( ! PULL_OK )) && (( IMAGE_WAIT > 0 )); then
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
