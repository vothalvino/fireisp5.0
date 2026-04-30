#!/usr/bin/env bash
# =============================================================================
# FireISP 5.0 — Let's Encrypt bootstrap
#
# Run this ONCE on the host before starting the full production stack.
# It solves the chicken-and-egg problem: nginx needs TLS certs to start,
# but Certbot needs a running nginx to answer the HTTP-01 ACME challenge.
#
# Strategy:
#   1. Create a dummy self-signed certificate so nginx can start.
#   2. Bring up only the nginx container.
#   3. Use Certbot (via Docker) to issue the real certificate.
#   4. Certbot's deploy hook copies the certs to ./nginx/certs/.
#   5. Reload nginx so it picks up the real certificate.
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

# ── Parse flags ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --cloudflare) USE_CLOUDFLARE=1 ;;
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

DOCKER_COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] && DOCKER_COMPOSE_CMD="$DOCKER_COMPOSE_CMD --env-file $ENV_FILE"

# ── Helper functions ──────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker is not installed."
docker info >/dev/null 2>&1       || die "Docker daemon is not running."

mkdir -p "$CERTS_DIR" "$LE_DIR"

# ── Step 1: Create dummy self-signed certificate ─────────────────────────────
log "Creating temporary self-signed certificate for $DOMAIN ..."
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout "$CERTS_DIR/privkey.pem" \
  -out    "$CERTS_DIR/fullchain.pem" \
  -subj   "/CN=$DOMAIN" \
  2>/dev/null
log "Dummy certificate created."

# ── Step 2: Start nginx with the dummy certificate ───────────────────────────
# Use --no-deps so Docker Compose does not pull in the app/db/redis chain.
# Nginx can start without the upstream app; it only needs port 80 to answer
# the ACME HTTP-01 challenge from the /var/www/certbot webroot.
log "Starting nginx ..."
$DOCKER_COMPOSE_CMD up --no-deps -d nginx
sleep 3  # give nginx a moment to accept connections

# Verify nginx is up
if ! $DOCKER_COMPOSE_CMD exec -T nginx nginx -t >/dev/null 2>&1; then
  die "nginx failed to start — check nginx.conf for syntax errors."
fi
log "nginx is running."

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
  $DOCKER_COMPOSE_CMD run --rm -T certbot certonly \
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

# ── Step 5: Reload nginx with the real certificate ───────────────────────────
log "Reloading nginx with the real certificate ..."
$DOCKER_COMPOSE_CMD exec -T nginx nginx -s reload

log ""
log "✅  TLS bootstrap complete!"
log "    Domain : $DOMAIN"
log "    Certs  : $CERTS_DIR/"
[[ "$STAGING" == "1" ]] && log "    ⚠️  Staging certificate — not trusted by browsers. Re-run without STAGING=1 for production."
log ""
log "Next steps:"
log "  1. Start the full stack:  $DOCKER_COMPOSE_CMD up -d"
log "  2. Certificates renew automatically every ~60 days (certbot service checks every 12h)."
log "  3. nginx reloads every 6 hours to pick up renewed certs automatically."
