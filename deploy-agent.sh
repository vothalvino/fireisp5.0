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

# Credentials come from .env.prod, which is root-readable on the host. The agent
# deliberately has NO API token and no network listener: it talks to MySQL
# through the existing compose stack, so there is no new credential to leak and
# no new port to reach.
# shellcheck disable=SC1090
DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_USER="$(grep -E '^DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_NAME="${DB_NAME:-fireisp}"
DB_USER="${DB_USER:-fireisp}"

# The compose service that runs MySQL. `db-primary`, NOT `db` — this script
# originally guessed `db` and every run died with "no such service: db", so the
# heartbeat was never written and the Update button never appeared. Overridable
# for a non-standard compose file; tests cross-check the default against
# docker-compose.prod.yml so it cannot silently drift again.
DB_SERVICE="${FIREISP_DB_SERVICE:-db-primary}"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# MYSQL_PWD rather than -p on the command line: an argv password is visible in
# `ps` to every user on the box for the lifetime of the query.
sql() {
  MYSQL_PWD="$DB_PASSWORD" dc exec -T "$DB_SERVICE" \
    mysql --batch --skip-column-names --default-character-set=utf8mb4 \
          -u "$DB_USER" "$DB_NAME" -e "$1" 2>/dev/null
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
  echo "deploy-agent: could not reach the database via compose service '$DB_SERVICE' — is the stack up?" >&2
  exit 0   # exit 0: a stopped stack is not an agent failure worth alerting on
}

# ── Claim one request ────────────────────────────────────────────────────────
# Claim-by-update, not select-then-update: two overlapping timer runs (a deploy
# that outlives the interval) must not both run redeploy.sh. Only the row that
# is still 'pending' is claimed, so the second run's UPDATE matches nothing.
sql "UPDATE deploy_requests
        SET status = 'running', started_at = NOW()
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 1;"

REQUEST_ID="$(sql "SELECT id FROM deploy_requests WHERE status = 'running' ORDER BY id ASC LIMIT 1;" | head -1)"
[[ -n "${REQUEST_ID:-}" ]] || exit 0    # nothing to do — the common case

# A stale 'running' row from a previous run that was killed mid-deploy would be
# re-claimed here forever. Anything running for more than an hour is declared
# failed rather than retried: a redeploy that has not finished in an hour is not
# going to, and silently re-running it is worse than reporting it.
sql "UPDATE deploy_requests
        SET status = 'failed', finished_at = NOW(), exit_code = -1,
            output_tail = 'Deploy did not report a result within one hour; marked failed by the agent. Check the host and redeploy from the CLI.'
      WHERE status = 'running' AND started_at < NOW() - INTERVAL 1 HOUR;"

# Re-check: the sweep above may have just failed the row we thought we had.
STILL_MINE="$(sql "SELECT id FROM deploy_requests WHERE id = ${REQUEST_ID} AND status = 'running';" | head -1)"
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
for attempt in 1 2 3 4 5; do
  if sql "UPDATE deploy_requests
             SET status = '${STATUS}', finished_at = NOW(),
                 exit_code = ${EXIT_CODE}, output_tail = '${TAIL_ESC}'
           WHERE id = ${REQUEST_ID};"; then
    break
  fi
  echo "deploy-agent: result write failed (attempt ${attempt}), retrying" >&2
  sleep 5
done

echo "deploy-agent: request ${REQUEST_ID} ${STATUS} (exit ${EXIT_CODE})"
exit 0
