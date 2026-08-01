#!/usr/bin/env bash
#
# FireISP deploy agent — the privileged half of the "Update" button.
#
# Runs on the HOST as root, outside Docker, on a systemd timer. Claims a pending
# row from deploy_requests and runs redeploy.sh. That is the whole job.
#
# Install (one time):
#     sudo cp /opt/fireisp/deploy/fireisp-deploy-agent.{service,timer} /etc/systemd/system/
#     sudo systemctl daemon-reload
#     sudo systemctl enable --now fireisp-deploy-agent.timer
#
# The unit runs this file from the checkout, so `redeploy` keeps the agent up to
# date on its own — there is no copy in /usr/local/bin to fall out of step.
#
# ── Why this exists at all ───────────────────────────────────────────────────
#
# A GUI button that restarts the stack needs authority the application must not
# have. Mounting the Docker socket into the app container is root on the host:
# any RCE or path traversal in FireISP would own the machine, not just the app.
# That architecture was refused for the TLS renew button and is refused here.
#
# So the privilege lives here instead, and the container's only power is to
# INSERT A ROW.
#
# ── The invariant that makes that safe ───────────────────────────────────────
#
# THIS SCRIPT NEVER READS AN ARGUMENT OUT OF THE DATABASE. It runs redeploy.sh
# with no arguments, always. The request row's ONLY meaning is "somebody asked".
# There is deliberately no target column: a request that could name a commit or
# an image would hand a compromised app an arbitrary-image-deploy primitive,
# which is most of what the Docker socket would have given away.
#
# Worst case, with the app fully compromised: an attacker can trigger a redeploy
# of the signed image CI already published for current main — the thing that was
# going to be deployed anyway. Nothing is parameterised, so nothing is injectable.
#
set -euo pipefail

APP_DIR="${FIREISP_DIR:-/opt/fireisp}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
ENV_FILE="$APP_DIR/.env.prod"
AGENT_VERSION="1"
# How much redeploy output to keep for the UI. Enough to see what failed, not so
# much that a root process dumps a whole log into a table the GUI renders.
OUTPUT_TAIL_BYTES="${FIREISP_DEPLOY_TAIL_BYTES:-4000}"

[[ -f "$COMPOSE_FILE" ]] || { echo "deploy-agent: $COMPOSE_FILE not found" >&2; exit 1; }
[[ -f "$ENV_FILE" ]]     || { echo "deploy-agent: $ENV_FILE not found" >&2; exit 1; }

# The opt-out, honoured here as well as by redeploy (which disables the timer).
# Two layers because they cover different windows: an operator who sets the flag
# and does NOT redeploy has still expressed a decision, and the timer would go on
# polling until the next deploy. Exiting before the heartbeat is what makes that
# visible — no heartbeat means the GUI reports no agent and hides the button,
# which is exactly what "GUI deploys are off" should look like.
FLAG="$( { grep -E '^[[:space:]]*(export[[:space:]]+)?FIREISP_DEPLOY_AGENT[[:space:]]*=' "$ENV_FILE" || true; } 2>/dev/null \
  | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]*#.*$//' | tr -d '\r"'"'"' \t' | tr '[:upper:]' '[:lower:]' )" || FLAG=""
case "$FLAG" in
  0|false|no|off) echo "deploy-agent: FIREISP_DEPLOY_AGENT=${FLAG} — GUI deploys are disabled; exiting"; exit 0 ;;
esac

# The agent deliberately has NO API token and no network listener: it talks to
# MySQL through the existing compose stack, so there is no new credential to
# leak and no new port to reach.
#
# It does NOT re-parse .env.prod for credentials. An earlier version did
# (grep | cut), and any file format compose's dotenv parser accepts but a naive
# grep does not — quoted values, an `export` prefix, CRLF endings, a repeated
# key where the later definition wins — made every run fail "Access denied" on
# a box where the app itself was connecting fine. Instead the query runs with
# the MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE that compose already
# injected into the MySQL container: the same parse, of the same file, that the
# running stack authenticates with. If the app can log in, so can the agent —
# by construction. (.env.prod stays required above: compose itself needs it to
# interpolate the stack; this script just never re-reads its values.)

# The compose service that runs MySQL. `db-primary`, NOT `db` — this script
# originally guessed `db` and every run died with "no such service: db", so the
# heartbeat was never written and the Update button never appeared. Overridable
# for a non-standard compose file; tests cross-check the default against
# docker-compose.prod.yml so it cannot silently drift again.
DB_SERVICE="${FIREISP_DB_SERVICE:-db-primary}"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# Each query's stderr lands here so a failure can be REPORTED, not guessed at —
# every call site below classifies it via err_report. The first version
# discarded it (2>/dev/null) and printed "is the stack up?" while the stack was
# up and mysql was answering "Access denied", which sent a live diagnosis in
# exactly the wrong direction.
ERR_FILE="$(mktemp)"
trap 'rm -f "$ERR_FILE"' EXIT

# THE STATEMENT GOES IN ON STDIN, and the credentials are expanded by the shell
# INSIDE the container (hence the single quotes). Nothing sensitive is in the
# argv of a HOST process: /proc/<pid>/cmdline is mode 0444, so every local user
# can read the argv of a root process for as long as it runs.
#
# An `exec -e SQL_STMT=...` form was tried first and is NOT equivalent: bash
# expands it into argv of the host `docker compose` process, which put the whole
# statement — including output_tail, i.e. registry URLs, image digests and
# migration output captured from a root process — where any local account could
# poll for it. MYSQL_PWD rather than `-p` is the same rule applied to the
# password.
sql() {
  printf '%s' "$1" | dc exec -T "$DB_SERVICE" sh -c \
    'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --batch --skip-column-names --default-character-set=utf8mb4 -u "$MYSQL_USER" "$MYSQL_DATABASE"' \
    2>"$ERR_FILE"
}

# Classify the last sql() failure for the journal.
#
# THE RAW STDERR IS NEVER ECHOED. It is the stderr of a command invoked with
# `--env-file <the secrets file>`, and compose's dotenv parser quotes the
# offending source line back on a parse error — so a mis-edited .env.prod would
# print a line of DB_PASSWORD/ENCRYPTION_KEY into the journal every 30s, where
# `adm`/`systemd-journal` members and any log shipper would collect it. Only
# the recognised shape is reported; anything else gets a pointer to the logs
# that can safely hold it.
err_report() {
  local what="$1" err
  err="$(head -c 400 "$ERR_FILE" 2>/dev/null | tr '\n' ' ')" || err=""
  case "$err" in
    *"Access denied"*)
      echo "deploy-agent: ${what}: MySQL rejected the credentials the stack itself runs with — the '${DB_SERVICE}' container's MYSQL_USER/MYSQL_PASSWORD no longer match the database (changed after first init?)" >&2 ;;
    *"doesn't exist"*|*"Unknown database"*)
      echo "deploy-agent: ${what}: schema missing — migration 439 has not been applied; run a deploy, or the migrations" >&2 ;;
    *"no such service"*|*"is not running"*|*"No such container"*|*"Cannot connect to the Docker daemon"*|*"Can't connect"*|*"Lost connection"*|*"server has gone away"*|"")
      echo "deploy-agent: ${what}: could not reach the database via compose service '${DB_SERVICE}' — is the stack up?" >&2 ;;
    *)
      echo "deploy-agent: ${what}: the database command failed. Its output is not reproduced here because it can quote lines of .env.prod — see: docker compose -f ${COMPOSE_FILE} logs ${DB_SERVICE}" >&2 ;;
  esac
}

# Escape a value for single-quoted SQL. Only ever applied to strings this script
# produced (its own output, hostname) — never to anything from the database.
sql_escape() { printf '%s' "$1" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g"; }

# ── Heartbeat ────────────────────────────────────────────────────────────────
# Stamped EVERY run, before any work. This is what lets the GUI distinguish
# "no agent installed" from "deploy still running" — without it the button
# would be a stub whose UI fakes success, queueing requests nobody services.
HOST_ESC="$(sql_escape "$(hostname)")"
sql "INSERT INTO deploy_agent_status (id, last_seen_at, agent_version, hostname)
     VALUES (1, NOW(), '${AGENT_VERSION}', '${HOST_ESC}')
     ON DUPLICATE KEY UPDATE last_seen_at = NOW(),
                             agent_version = VALUES(agent_version),
                             hostname = VALUES(hostname);" || {
  err_report "heartbeat"
  exit 0   # exit 0: a stopped stack is not an agent failure worth alerting on
}

# ── Claim one request ────────────────────────────────────────────────────────
# Claim-by-update, not select-then-update: two overlapping timer runs (a deploy
# that outlives the interval) must not both run redeploy.sh. Only the row that
# is still 'pending' is claimed, so the second run's UPDATE matches nothing.
#
# Every step below reports before exiting. Bare `set -e` exits looked tidy but
# left `systemctl status` showing a failed unit and `journalctl -u
# fireisp-deploy-agent` — the command the UI tells the operator to run —
# completely empty.
sql "UPDATE deploy_requests
        SET status = 'running', started_at = NOW()
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 1;" || { err_report "claiming a request"; exit 1; }

REQUEST_ID="$(sql "SELECT id FROM deploy_requests WHERE status = 'running' ORDER BY id ASC LIMIT 1;")" \
  || { err_report "reading the claimed request"; exit 1; }
REQUEST_ID="$(printf '%s' "$REQUEST_ID" | head -1)"
[[ -n "${REQUEST_ID:-}" ]] || exit 0    # nothing to do — the common case

# A stale 'running' row from a previous run that was killed mid-deploy would be
# re-claimed here forever. Anything running for more than an hour is declared
# failed rather than retried: a redeploy that has not finished in an hour is not
# going to, and silently re-running it is worse than reporting it.
sql "UPDATE deploy_requests
        SET status = 'failed', finished_at = NOW(), exit_code = -1,
            output_tail = 'Deploy did not report a result within one hour; marked failed by the agent. Check the host and redeploy from the CLI.'
      WHERE status = 'running' AND started_at < NOW() - INTERVAL 1 HOUR;" \
  || { err_report "sweeping stale deploys"; exit 1; }

# Re-check: the sweep above may have just failed the row we thought we had.
STILL_MINE="$(sql "SELECT id FROM deploy_requests WHERE id = ${REQUEST_ID} AND status = 'running';")" \
  || { err_report "re-checking the claim"; exit 1; }
STILL_MINE="$(printf '%s' "$STILL_MINE" | head -1)"
[[ -n "${STILL_MINE:-}" ]] || exit 0

echo "deploy-agent: running redeploy for request ${REQUEST_ID}"

# ── The one fixed command ────────────────────────────────────────────────────
# No arguments. Nothing from the database reaches this line — that is the whole
# security argument, and it is why it is written literally rather than built up
# in a variable.
set +e
OUTPUT="$("$APP_DIR/redeploy.sh" 2>&1)"
EXIT_CODE=$?
set -e

TAIL="$(printf '%s' "$OUTPUT" | tail -c "$OUTPUT_TAIL_BYTES")"
TAIL_ESC="$(sql_escape "$TAIL")"
STATUS=$([[ $EXIT_CODE -eq 0 ]] && echo 'succeeded' || echo 'failed')

# Retried: a successful deploy recreates the app container, and the compose
# stack can be briefly unavailable right as we write the result. Losing the
# result of a deploy that WORKED would leave the UI showing "running" forever.
WROTE_RESULT=0
for attempt in 1 2 3 4 5; do
  if sql "UPDATE deploy_requests
             SET status = '${STATUS}', finished_at = NOW(),
                 exit_code = ${EXIT_CODE}, output_tail = '${TAIL_ESC}'
           WHERE id = ${REQUEST_ID};"; then
    WROTE_RESULT=1
    break
  fi
  err_report "writing the result of request ${REQUEST_ID} (attempt ${attempt}/5)"
  sleep 5
done

# Report what actually happened. Announcing "succeeded" after five failed writes
# would describe a row the GUI never received — the UI would sit on "running"
# forever while the journal claimed the deploy was finished, which is precisely
# the stub-that-fakes-success failure this feature is built to avoid.
if (( WROTE_RESULT )); then
  echo "deploy-agent: request ${REQUEST_ID} ${STATUS} (exit ${EXIT_CODE})"
  exit 0
fi
echo "deploy-agent: request ${REQUEST_ID} ${STATUS} (exit ${EXIT_CODE}) but the result could NOT be written back after 5 attempts — the GUI will show it as running until the agent's one-hour sweep marks it failed." >&2
exit 1
