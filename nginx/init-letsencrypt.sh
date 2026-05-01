#!/usr/bin/env bash
# =============================================================================
# FireISP 5.0 — Let's Encrypt bootstrap
#
# Run this ONCE on the host before starting the full production stack.
# It solves the chicken-and-egg problem: nginx needs TLS certs to start,
# but Certbot needs a running nginx to answer the HTTP-01 ACME challenge.
#
# Strategy:
#   1. Create a dummy self-signed certificate so nginx can start with the
#      production config later (it requires the cert files to exist).
#   2. Temporarily swap nginx.conf → nginx.bootstrap.conf so nginx can start
#      WITHOUT the `app` upstream container (open-source nginx resolves
#      `upstream { server app:3000; }` at startup, which fails with
#      `[emerg] host not found in upstream "app:3000"` when --no-deps is used).
#   3. Bring up only the nginx container.
#   4. Use Certbot (via Docker) to issue the real certificate.
#   5. Certbot's deploy hook copies the certs to ./nginx/certs/.
#   6. Restore the production nginx.conf and reload nginx so it picks up the
#      real certificate and the full upstream/TLS configuration.
#
# Usage:
#   chmod +x nginx/init-letsencrypt.sh
#   DOMAIN=isp.example.com EMAIL=admin@example.com ./nginx/init-letsencrypt.sh
#
# For wildcard certificates via Cloudflare DNS-01 challenge:
#   CF_API_TOKEN=<token> DOMAIN=isp.example.com EMAIL=admin@example.com \
#     ./nginx/init-letsencrypt.sh --cloudflare
#
# For staging (Let's Encrypt test environment — no rate limits):
#   STAGING=1 DOMAIN=isp.example.com EMAIL=admin@example.com \
#     ./nginx/init-letsencrypt.sh
# =============================================================================
set -euo pipefail

# ── Required parameters ───────────────────────────────────────────────────────
DOMAIN="${DOMAIN:?Set DOMAIN=your.domain.com before running this script}"
EMAIL="${EMAIL:?Set EMAIL=admin@your.domain.com before running this script}"

# ── Optional parameters ───────────────────────────────────────────────────────
STAGING="${STAGING:-0}"           # Set to 1 to use Let's Encrypt staging CA
USE_CLOUDFLARE=0
USE_HOST_NGINX=0                  # Set to 1 (or pass --host-nginx) to bootstrap
                                  # using a host-level nginx instead of the
                                  # Docker nginx container.

# ── Parse flags ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --cloudflare)  USE_CLOUDFLARE=1  ;;
    --host-nginx)  USE_HOST_NGINX=1  ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [[ "$USE_CLOUDFLARE" == "1" ]]; then
  : "${CF_API_TOKEN:?Set CF_API_TOKEN when using --cloudflare}"
fi

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CERTS_DIR="$SCRIPT_DIR/certs"
LE_DIR="$SCRIPT_DIR/letsencrypt"   # bind-mounted as /etc/letsencrypt in certbot containers
COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
ENV_FILE="$REPO_ROOT/.env.prod"
NGINX_CONF="$SCRIPT_DIR/nginx.conf"
BOOTSTRAP_CONF="$SCRIPT_DIR/nginx.bootstrap.conf"
NGINX_CONF_BACKUP="$SCRIPT_DIR/.nginx.conf.bootstrap-backup"

DOCKER_COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] && DOCKER_COMPOSE_CMD="$DOCKER_COMPOSE_CMD --env-file $ENV_FILE"

# ── Helper functions ──────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

# Restore the production nginx.conf if we swapped in the bootstrap one.
# Idempotent — safe to call multiple times and from the EXIT trap.
restore_nginx_conf() {
  if [[ -f "$NGINX_CONF_BACKUP" ]]; then
    mv -f "$NGINX_CONF_BACKUP" "$NGINX_CONF"
    log "Restored production nginx.conf."
  fi
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker is not installed."
docker info >/dev/null 2>&1       || die "Docker daemon is not running."

[[ -f "$NGINX_CONF" ]]     || die "Missing $NGINX_CONF"

if [[ "$USE_HOST_NGINX" == "0" ]]; then
  [[ -f "$BOOTSTRAP_CONF" ]] || die "Missing $BOOTSTRAP_CONF — required for first-time TLS bootstrap."
fi

mkdir -p "$CERTS_DIR" "$LE_DIR"

# ── Step 1: Create dummy self-signed certificate ─────────────────────────────
log "Creating temporary self-signed certificate for $DOMAIN ..."
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout "$CERTS_DIR/privkey.pem" \
  -out    "$CERTS_DIR/fullchain.pem" \
  -subj   "/CN=$DOMAIN" \
  2>/dev/null
log "Dummy certificate created."

# =============================================================================
# ── HOST-NGINX bootstrap path ────────────────────────────────────────────────
# When --host-nginx is passed, the system-level nginx service manages TLS and
# proxies traffic to the Docker app container.  We skip the Docker nginx
# container entirely and use systemctl to manage the host nginx daemon.
# =============================================================================
if [[ "$USE_HOST_NGINX" == "1" ]]; then

  # ── Verify host nginx is installed ────────────────────────────────────────
  command -v nginx >/dev/null 2>&1 || \
    die "nginx is not installed on the host. Install with: apt install nginx"

  # Ensure the certbot webroot directory exists so nginx can start without
  # errors on the location block even before the first certificate issuance.
  mkdir -p "$SCRIPT_DIR/certbot-www/.well-known/acme-challenge"

  # ── Test and reload / start host nginx ────────────────────────────────────
  if ! NGINX_TEST_OUT="$(nginx -t 2>&1)"; then
    echo "[ERROR] Host nginx failed configuration test. Output of 'nginx -t':" >&2
    printf '%s\n' "$NGINX_TEST_OUT" | sed 's/^/  /' >&2
    die "Fix the nginx configuration errors above, then re-run this script."
  fi

  log "Starting / reloading host nginx ..."
  if systemctl is-active --quiet nginx 2>/dev/null; then
    systemctl reload nginx
  else
    systemctl start nginx
  fi
  sleep 2  # give nginx a moment to accept connections
  log "Host nginx is running."

  # ── Step 3 (host-nginx): Obtain Let's Encrypt certificate ─────────────────
  STAGING_FLAG=""
  [[ "$STAGING" == "1" ]] && STAGING_FLAG="--staging"

  log "Requesting Let's Encrypt certificate for $DOMAIN ..."

  if [[ "$USE_CLOUDFLARE" == "1" ]]; then
    # ── DNS-01 challenge via Cloudflare (supports wildcard certs) ─────────────
    log "Using Cloudflare DNS-01 challenge ..."

    CF_INI="$SCRIPT_DIR/cloudflare.ini"
    printf 'dns_cloudflare_api_token = %s\n' "$CF_API_TOKEN" > "$CF_INI"
    chmod 600 "$CF_INI"

    docker run --rm \
      -v "$LE_DIR:/etc/letsencrypt" \
      -v "$CF_INI:/cloudflare.ini:ro" \
      certbot/dns-cloudflare:latest certonly \
        --dns-cloudflare \
        --dns-cloudflare-credentials /cloudflare.ini \
        --dns-cloudflare-propagation-seconds 60 \
        -d "$DOMAIN" -d "*.$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos --non-interactive \
        $STAGING_FLAG

    rm -f "$CF_INI"
  else
    # ── HTTP-01 challenge via webroot (host nginx serves the challenge) ────────
    # The certbot-www bind-mount in docker-compose.host-nginx.yml makes the
    # same directory visible to both the Docker certbot container (write) and
    # the host nginx (read).  We use a plain `docker run` here (not compose)
    # so the certbot image can be pulled and run without the rest of the stack.
    docker run --rm \
      -v "$LE_DIR:/etc/letsencrypt" \
      -v "$SCRIPT_DIR/certbot-www:/var/www/certbot" \
      -v "$CERTS_DIR:/certs" \
      -v "$SCRIPT_DIR/certbot-deploy-hook.sh:/etc/letsencrypt/renewal-hooks/deploy/copy-certs.sh:ro" \
      certbot/certbot:latest certonly \
        --webroot \
        --webroot-path /var/www/certbot \
        -d "$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos --non-interactive \
        $STAGING_FLAG
  fi

  log "Certificate issued successfully."

  # ── Step 4 (host-nginx): Copy real certificate to ./nginx/certs/ ────────────
  log "Installing certificate into $CERTS_DIR ..."
  LIVE_DIR="$LE_DIR/live/$DOMAIN"
  if [[ ! -f "$LIVE_DIR/fullchain.pem" ]]; then
    die "Certificate not found at $LIVE_DIR — certbot may have failed."
  fi
  cp "$LIVE_DIR/fullchain.pem" "$CERTS_DIR/fullchain.pem"
  cp "$LIVE_DIR/privkey.pem"   "$CERTS_DIR/privkey.pem"
  chmod 644 "$CERTS_DIR/fullchain.pem"
  chmod 640 "$CERTS_DIR/privkey.pem"

  # ── Step 5 (host-nginx): Reload host nginx to pick up the real certificate ───
  log "Reloading host nginx with the real certificate ..."
  nginx -t || die "nginx config test failed after cert install — check /etc/nginx/conf.d/fireisp.conf"
  systemctl reload nginx
  log "Host nginx reloaded."

else
# =============================================================================
# ── DOCKER-NGINX bootstrap path (default) ────────────────────────────────────
# =============================================================================

# ── Step 2: Swap in the bootstrap nginx.conf and start nginx ─────────────────
# The production nginx.conf declares `upstream app { server app:3000; }`,
# which open-source nginx resolves at startup. With `--no-deps` the `app`
# container is not running, so nginx would abort with
#   [emerg] host not found in upstream "app:3000"
# We swap in a minimal config that only listens on :80 and serves the ACME
# challenge — no upstream, no TLS server. A trap restores the production
# config even if this script aborts unexpectedly.
log "Swapping in bootstrap nginx config ..."
cp "$NGINX_CONF" "$NGINX_CONF_BACKUP"
trap 'restore_nginx_conf' EXIT
cp "$BOOTSTRAP_CONF" "$NGINX_CONF"

# Use --no-deps so Docker Compose does not pull in the app/db/redis chain,
# and --force-recreate so nginx picks up the swapped config if a previous
# (failed) bootstrap left a container running with the old conf mounted.
log "Starting nginx with bootstrap config ..."
$DOCKER_COMPOSE_CMD up --no-deps -d --force-recreate nginx
sleep 3  # give nginx a moment to accept connections

# Verify nginx is up. Capture nginx -t output so we can surface the real
# error (e.g. a syntax mistake or missing file) instead of the misleading
# "check nginx.conf for syntax errors" message that masked the original
# upstream-resolution failure for a long time.
if ! NGINX_TEST_OUT="$($DOCKER_COMPOSE_CMD exec -T nginx nginx -t 2>&1)"; then
  echo "[ERROR] nginx failed the configuration test. Output of 'nginx -t':" >&2
  printf '%s\n' "$NGINX_TEST_OUT" | sed 's/^/  /' >&2
  echo "[ERROR] Recent nginx container logs:" >&2
  $DOCKER_COMPOSE_CMD logs --tail=50 nginx 2>&1 | sed 's/^/  /' >&2 || true
  die "nginx is not running — see output above."
fi
log "nginx is running with bootstrap config."

# ── Step 3: Obtain the real Let's Encrypt certificate ────────────────────────
STAGING_FLAG=""
[[ "$STAGING" == "1" ]] && STAGING_FLAG="--staging"

log "Requesting Let's Encrypt certificate for $DOMAIN ..."

if [[ "$USE_CLOUDFLARE" == "1" ]]; then
  # ── DNS-01 challenge via Cloudflare (supports wildcard certs) ──────────────
  log "Using Cloudflare DNS-01 challenge ..."

  CF_INI="$SCRIPT_DIR/cloudflare.ini"
  printf 'dns_cloudflare_api_token = %s\n' "$CF_API_TOKEN" > "$CF_INI"
  chmod 600 "$CF_INI"

  # certbot/dns-cloudflare has the Cloudflare plugin pre-installed.
  # The ./nginx/letsencrypt bind-mount is used so this one-time issuance and
  # the ongoing compose certbot service share the same certificate store.
  docker run --rm \
    -v "$LE_DIR:/etc/letsencrypt" \
    -v "$CF_INI:/cloudflare.ini:ro" \
    certbot/dns-cloudflare:latest certonly \
      --dns-cloudflare \
      --dns-cloudflare-credentials /cloudflare.ini \
      --dns-cloudflare-propagation-seconds 60 \
      -d "$DOMAIN" -d "*.$DOMAIN" \
      --email "$EMAIL" \
      --agree-tos --non-interactive \
      $STAGING_FLAG

  rm -f "$CF_INI"
else
  # ── HTTP-01 challenge via webroot ─────────────────────────────────────────
  # -T disables pseudo-TTY allocation so the command does not try to attach
  # to the current terminal — without this flag Docker Compose will attempt
  # to allocate a PTY, which disrupts the SSH session when the installer is
  # run over a pipe (curl … | bash) or from a non-interactive terminal.
  #
  # --entrypoint certbot overrides the custom entrypoint defined in
  # docker-compose.prod.yml (the 12-hour renewal loop) so that `certonly`
  # is executed directly instead of being treated as a positional argument
  # to the loop shell script (which would cause a silent 12-hour hang).
  $DOCKER_COMPOSE_CMD run --rm -T --entrypoint certbot certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos --non-interactive \
    $STAGING_FLAG
fi

log "Certificate issued successfully."

# ── Step 4: Copy real certificate to ./nginx/certs/ ──────────────────────────
log "Installing certificate into $CERTS_DIR ..."
LIVE_DIR="$LE_DIR/live/$DOMAIN"
if [[ ! -f "$LIVE_DIR/fullchain.pem" ]]; then
  die "Certificate not found at $LIVE_DIR — certbot may have failed."
fi
cp "$LIVE_DIR/fullchain.pem" "$CERTS_DIR/fullchain.pem"
cp "$LIVE_DIR/privkey.pem"   "$CERTS_DIR/privkey.pem"
chmod 644 "$CERTS_DIR/fullchain.pem"
chmod 640 "$CERTS_DIR/privkey.pem"

# ── Step 5: Restore production nginx.conf and reload nginx ──────────────────
# Move the production config back into place, then recreate the nginx
# container so the full TLS server block, upstream pool, and security
# headers take effect with the freshly issued certificate.
log "Restoring production nginx.conf and reloading ..."
restore_nginx_conf
# Safe to drop the trap now: restore_nginx_conf has already moved the
# backup back into place and removed it, so a re-fire on EXIT would be
# an idempotent no-op anyway.
trap - EXIT

# `up -d --force-recreate` rather than `nginx -s reload` because the
# container was started with `--no-deps` and we now need it linked to
# the full stack lifecycle. The `app` service may still be down at this
# point (the operator brings it up in step 6 of tls-setup.md), so keep
# --no-deps here too — the nginx container will start, fail to resolve
# `app`, and Docker will restart it once `app` comes online via
# `docker compose up -d`. To avoid that flapping window we instead simply
# stop the bootstrap nginx; the operator's `docker compose up -d` will
# bring nginx back up alongside `app` with the production config.
$DOCKER_COMPOSE_CMD stop nginx >/dev/null 2>&1 || true
$DOCKER_COMPOSE_CMD rm -f nginx >/dev/null 2>&1 || true

fi  # end USE_HOST_NGINX / Docker-nginx branch

log ""
log "✅  TLS bootstrap complete!"
log "    Domain : $DOMAIN"
log "    Certs  : $CERTS_DIR/"
[[ "$STAGING" == "1" ]] && log "    ⚠️  Staging certificate — not trusted by browsers. Re-run without STAGING=1 for production."
log ""
log "Next steps:"
if [[ "$USE_HOST_NGINX" == "1" ]]; then
  log "  1. Start the FireISP stack (host-nginx overlay):"
  log "       docker compose -f $COMPOSE_FILE -f $(dirname "$COMPOSE_FILE")/docker-compose.host-nginx.yml up -d"
  log "  2. Certificates renew automatically every ~60 days (certbot service checks every 12h)."
  log "  3. Host nginx reloads every 6 hours via cron to pick up renewed certs."
else
  log "  1. Start the full stack:  $DOCKER_COMPOSE_CMD up -d"
  log "  2. Certificates renew automatically every ~60 days (certbot service checks every 12h)."
  log "  3. nginx reloads every 6 hours to pick up renewed certs automatically."
fi
