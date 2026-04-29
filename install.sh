#!/usr/bin/env bash
# =============================================================================
# FireISP 5.0 — One-line Installer
# =============================================================================
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/vothalvino/fireisp5.0/main/install.sh | bash
#
# With options (pass as environment variables before piping):
#   curl -fsSL .../install.sh | DOMAIN=isp.example.com EMAIL=admin@example.com bash
#
# Full variable reference:
#   DOMAIN              Public domain name (e.g. isp.example.com)
#   EMAIL               Email for Let's Encrypt + admin account
#   INSTALL_DIR         Target install directory (default: /opt/fireisp)
#   SKIP_TLS            Set to 1 to use a self-signed cert instead of Let's Encrypt
#   CF_API_TOKEN        Cloudflare API token — enables DNS-01 wildcard certificates
#   DB_PASSWORD         MySQL app user password     (auto-generated if omitted)
#   DB_ROOT_PASSWORD    MySQL root password          (auto-generated if omitted)
#   MYSQL_REPL_PASSWORD MySQL replication password   (auto-generated if omitted)
#   REDIS_PASSWORD      Redis password               (auto-generated if omitted)
#   JWT_SECRET          JWT signing secret           (auto-generated if omitted)
#   ENCRYPTION_KEY      AES-256 key for at-rest secrets (auto-generated if omitted)
#
# =============================================================================

set -euo pipefail

REPO_URL="https://github.com/vothalvino/fireisp5.0.git"
FIREISP_VERSION="5.0"
INSTALL_DIR="${INSTALL_DIR:-/opt/fireisp}"

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${GREEN}[✓]${RESET} $*"; }
info() { echo -e "${BLUE}[i]${RESET} $*"; }
warn() { echo -e "${YELLOW}[!]${RESET} $*"; }
die()  { echo -e "${RED}[✗]${RESET} $*" >&2; exit 1; }

# Prompt helper: skips the prompt when the variable is already set (env or
# previous prompt) so the installer is fully non-interactive when all variables
# are supplied upfront.
prompt() {
  local var="$1" msg="$2" default="${3:-}"
  if [[ -n "${!var:-}" ]]; then return; fi
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "${BOLD}${msg}${RESET} [${default}]: ")" val
    eval "$var=\"${val:-${default}}\""
  else
    local val=""
    while [[ -z "$val" ]]; do
      read -rp "$(echo -e "${BOLD}${msg}${RESET}: ")" val
    done
    eval "$var=\"$val\""
  fi
}

# gen_secret: 48 bytes of randomness → base64 → strip non-alphanumeric chars →
# truncate to 64 chars.  Produces a URL-safe alphanumeric string for JWT/HMAC.
gen_secret() { openssl rand -base64 48 | tr -d '\n/+=' | head -c 64; }

# gen_pass: 24 bytes → base64 → strip non-alphanumeric → ~32 printable chars.
# Used for MySQL and Redis passwords where shell-safe characters matter.
gen_pass()   { openssl rand -base64 24 | tr -d '\n/+='; }

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}${BOLD}"
echo "  ███████╗██╗██████╗ ███████╗    ██╗███████╗██████╗"
echo "  ██╔════╝██║██╔══██╗██╔════╝    ██║██╔════╝██╔══██╗"
echo "  █████╗  ██║██████╔╝█████╗      ██║███████╗██████╔╝"
echo "  ██╔══╝  ██║██╔══██╗██╔══╝      ██║╚════██║██╔═══╝"
echo "  ██║     ██║██║  ██║███████╗    ██║███████║██║"
echo "  ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝╚══════╝╚═╝  v${FIREISP_VERSION}"
echo -e "${RESET}"
echo "  Open-source ISP Management Software"
echo ""

# ── Preflight checks ───────────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v docker    >/dev/null 2>&1 || die "Docker is not installed.
  Install: https://docs.docker.com/get-docker/"
docker info          >/dev/null 2>&1 || die "Docker daemon is not running.
  Start it: sudo systemctl start docker"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is not installed.
  Install: https://docs.docker.com/compose/install/"
command -v git       >/dev/null 2>&1 || die "git is not installed.
  Install: sudo apt-get install -y git"
command -v openssl   >/dev/null 2>&1 || die "openssl is not installed.
  Install: sudo apt-get install -y openssl"

log "All prerequisites satisfied."

# ── Collect required configuration ────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Configuration ─────────────────────────────────────────────────────${RESET}"
echo ""

prompt DOMAIN "Public domain name (e.g. isp.example.com)"
prompt EMAIL  "Admin email address (used for Let's Encrypt and first-run account)"

SKIP_TLS="${SKIP_TLS:-0}"
if [[ "$SKIP_TLS" == "1" ]]; then
  warn "SKIP_TLS=1 — a self-signed certificate will be used (not trusted by browsers)."
else
  info "TLS: Let's Encrypt certificate will be obtained for ${DOMAIN}."
  info "     The domain must resolve to this server's public IP before continuing."
  if [[ -n "${CF_API_TOKEN:-}" ]]; then
    info "     Cloudflare DNS-01 challenge detected (CF_API_TOKEN is set)."
  fi
fi
echo ""

# ── Auto-generate secrets (skip if already set via env) ───────────────────────
: "${DB_PASSWORD:=$(gen_pass)}"
: "${DB_ROOT_PASSWORD:=$(gen_pass)}"
: "${MYSQL_REPL_PASSWORD:=$(gen_pass)}"
: "${REDIS_PASSWORD:=$(gen_pass)}"
: "${JWT_SECRET:=$(gen_secret)}"
: "${ENCRYPTION_KEY:=$(openssl rand -hex 32)}"
# ENCRYPTION_KEY uses hex (not base64) because the app expects a 64-char hex
# string that it passes directly to crypto.createCipheriv as a 32-byte key.

# ── Clone / update repository ─────────────────────────────────────────────────
echo -e "${BOLD}── Downloading FireISP ────────────────────────────────────────────────${RESET}"
echo ""

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Existing installation found at $INSTALL_DIR — pulling latest changes..."
  git -C "$INSTALL_DIR" pull --ff-only
  log "Repository updated."
else
  info "Cloning FireISP into $INSTALL_DIR ..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  log "Repository cloned."
fi

cd "$INSTALL_DIR"

# ── Write .env.prod ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Writing .env.prod ──────────────────────────────────────────────────${RESET}"

ENV_FILE="$INSTALL_DIR/.env.prod"

cat > "$ENV_FILE" <<ENVEOF
# =============================================================================
# FireISP 5.0 — Production environment
# Generated by install.sh on $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# ⚠  Keep this file secret — never commit it to version control.
# =============================================================================

# ---- Application -------------------------------------------------------------
NODE_ENV=production
PORT=3000
APP_URL=https://${DOMAIN}
LOG_LEVEL=info

# ---- TLS / Let's Encrypt -----------------------------------------------------
DOMAIN=${DOMAIN}
CERTBOT_EMAIL=${EMAIL}

# ---- MySQL -------------------------------------------------------------------
DB_HOST=db-primary
DB_PORT=3306
DB_USER=fireisp
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=fireisp
DB_ROOT_PASSWORD=${DB_ROOT_PASSWORD}

# MySQL replication
MYSQL_REPL_USER=repl_user
MYSQL_REPL_PASSWORD=${MYSQL_REPL_PASSWORD}

# ---- Redis -------------------------------------------------------------------
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_MAXMEMORY=256mb

# ---- JWT / Sessions ----------------------------------------------------------
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=8h

# ---- Encryption (at-rest secrets) --------------------------------------------
# AES-256-GCM key for payment gateway credentials, PAC passwords, etc.
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ---- SMTP (configure after install) ------------------------------------------
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@${DOMAIN}

# ---- RADIUS (configure after install) ----------------------------------------
RADIUS_SECRET=
RADIUS_HOST=127.0.0.1
RADIUS_COA_PORT=3799

# ---- Optional: Sentry error tracking ----------------------------------------
# SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
ENVEOF

chmod 600 "$ENV_FILE"
log ".env.prod written to $ENV_FILE"

# ── TLS certificates ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── TLS Certificates ────────────────────────────────────────────────────${RESET}"
echo ""

mkdir -p "$INSTALL_DIR/nginx/certs" "$INSTALL_DIR/nginx/letsencrypt"

if [[ "$SKIP_TLS" == "1" ]]; then
  warn "Creating self-signed certificate (not trusted by browsers)."
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$INSTALL_DIR/nginx/certs/privkey.pem" \
    -out    "$INSTALL_DIR/nginx/certs/fullchain.pem" \
    -subj   "/CN=${DOMAIN}" 2>/dev/null
  log "Self-signed certificate created."
else
  info "Bootstrapping Let's Encrypt TLS for ${DOMAIN} ..."
  LETSENCRYPT_SCRIPT="$INSTALL_DIR/nginx/init-letsencrypt.sh"
  [[ -f "$LETSENCRYPT_SCRIPT" ]] || die "TLS bootstrap script not found: $LETSENCRYPT_SCRIPT
  The repository may be incomplete. Re-run the installer."
  if [[ -n "${CF_API_TOKEN:-}" ]]; then
    CF_API_TOKEN="$CF_API_TOKEN" DOMAIN="$DOMAIN" EMAIL="$EMAIL" \
      bash "$LETSENCRYPT_SCRIPT" --cloudflare
  else
    DOMAIN="$DOMAIN" EMAIL="$EMAIL" \
      bash "$LETSENCRYPT_SCRIPT"
  fi
  log "Let's Encrypt certificate obtained."
fi

# ── Start the stack ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Starting FireISP ─────────────────────────────────────────────────────${RESET}"
echo ""

COMPOSE="docker compose -f $INSTALL_DIR/docker-compose.prod.yml --env-file $ENV_FILE"

info "Building and starting containers (first run may take a few minutes)..."
$COMPOSE up -d --build
log "Containers started."

# ── Wait for database ─────────────────────────────────────────────────────────
# 30 iterations × 10 s = 300 s (5 minutes) maximum wait.
MAX_DB_WAIT_ITERATIONS=30
info "Waiting for MySQL to be ready (up to 5 minutes)..."
for i in $(seq 1 "$MAX_DB_WAIT_ITERATIONS"); do
  if $COMPOSE exec -T db-primary \
      mysqladmin ping -h localhost -u root "--password=${DB_ROOT_PASSWORD}" \
      --silent >/dev/null 2>&1; then
    log "Database is ready."
    break
  fi
  if [[ $i -eq $MAX_DB_WAIT_ITERATIONS ]]; then
    die "Database did not become healthy within 5 minutes.
  Check logs with: $COMPOSE logs db-primary"
  fi
  sleep 10
done

# ── Wait for app container ─────────────────────────────────────────────────────
# The app container may need a moment to finish its Node.js startup before
# scripts can be exec'd inside it.  Poll /health until it responds 200.
MAX_APP_WAIT_ITERATIONS=18  # 18 × 10 s = 3 minutes
info "Waiting for the app container to be healthy (up to 3 minutes)..."
for i in $(seq 1 "$MAX_APP_WAIT_ITERATIONS"); do
  if $COMPOSE exec -T app \
      wget -qO- http://localhost:3000/health >/dev/null 2>&1; then
    log "App container is healthy."
    break
  fi
  if [[ $i -eq $MAX_APP_WAIT_ITERATIONS ]]; then
    die "App container did not become healthy within 3 minutes.
  Check logs with: $COMPOSE logs app"
  fi
  sleep 10
done

# ── Database migrations ────────────────────────────────────────────────────────
info "Running database migrations..."
$COMPOSE exec -T app node src/scripts/migrate.js
log "Migrations applied."

# ── Seed default data ─────────────────────────────────────────────────────────
info "Seeding default roles, permissions, settings, and tax rates..."
$COMPOSE exec -T app node src/scripts/seed.js
log "Seed data loaded."

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  ✅  FireISP 5.0 is installed and running!${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}URL${RESET}           https://${DOMAIN}"
echo -e "  ${BOLD}API Docs${RESET}      https://${DOMAIN}/api/docs"
echo -e "  ${BOLD}Swagger UI${RESET}    https://${DOMAIN}/api/docs"
echo ""
echo -e "  ${BOLD}Install directory${RESET}  $INSTALL_DIR"
echo -e "  ${BOLD}Environment file${RESET}   $ENV_FILE"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "   1. Open https://${DOMAIN} in your browser"
echo -e "   2. Create your admin account on first login"
echo -e "   3. Configure SMTP in Settings → Organization → Email"
echo -e "   4. Fill in your ISP organization details"
echo ""
echo -e "  ${BOLD}Management commands:${RESET}"
echo -e "   Logs    $COMPOSE logs -f"
echo -e "   Stop    $COMPOSE down"
echo -e "   Restart $COMPOSE restart"
echo -e "   Update  git -C $INSTALL_DIR pull && $COMPOSE up -d --build"
echo ""
echo -e "  ${YELLOW}${BOLD}⚠  Store $ENV_FILE securely — it contains all generated credentials.${RESET}"
echo ""
