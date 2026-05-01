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

# ── Root / sudo check ──────────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  die "This installer must be run as root (or with sudo).
  Re-run:  sudo bash $0"
fi

# ── Persistent-session warning ────────────────────────────────────────────────
# Installation takes several minutes and involves long-running Docker builds.
# If the SSH connection drops mid-install the process will be killed before
# nginx or the database are fully configured.  Abort here if the user is not
# already inside a screen / tmux session, and advise them to use one.
if [[ -z "${STY:-}" && -z "${TMUX:-}" ]]; then
  warn "You do not appear to be running inside a persistent terminal session"
  warn "(screen or tmux).  If your SSH connection drops during the install"
  warn "the process will be killed before it completes."
  warn ""
  warn "It is strongly recommended to run the installer inside screen or tmux:"
  warn "  screen -S fireisp"
  warn "  # or"
  warn "  tmux new -s fireisp"
  warn ""
  warn "Press Ctrl-C within 15 seconds to abort, or wait to continue anyway..."
  sleep 15 || true
fi

# ── OS detection ──────────────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  source /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
else
  OS_ID="unknown"
  OS_LIKE=""
fi

is_debian_based() {
  [[ "$OS_ID" == "ubuntu" || "$OS_ID" == "debian" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]
}

if ! is_debian_based; then
  warn "This installer is optimised for Ubuntu/Debian."
  warn "Detected OS: ${OS_ID}. Continuing, but apt-based auto-install will be skipped."
fi

# ── apt helper ────────────────────────────────────────────────────────────────
_apt_updated=0
apt_install() {
  if ! is_debian_based; then
    die "Cannot auto-install '$*' — not a Debian/Ubuntu system. Please install manually and re-run."
  fi
  if [[ "$_apt_updated" -eq 0 ]]; then
    info "Running apt-get update..."
    apt-get update -qq
    _apt_updated=1
  fi
  info "Installing: $*"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
}

# ── Auto-install curl (needed by Docker setup script) ─────────────────────────
if ! command -v curl >/dev/null 2>&1; then
  apt_install curl ca-certificates
  log "curl installed."
fi

# ── Auto-install git ──────────────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  apt_install git
  log "git installed."
fi

# ── Auto-install openssl ──────────────────────────────────────────────────────
if ! command -v openssl >/dev/null 2>&1; then
  apt_install openssl
  log "openssl installed."
fi

# ── Auto-install Docker CE ────────────────────────────────────────────────────
install_docker() {
  info "Docker not found — installing Docker CE from the official repository..."

  # Remove any old conflicting packages shipped by the distro
  for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    apt-get remove -y "$pkg" >/dev/null 2>&1 || true
  done

  if [[ "$_apt_updated" -eq 0 ]]; then
    apt-get update -qq
    _apt_updated=1
  fi

  # Install dependencies for the apt HTTPS transport and GPG
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release

  # Add Docker's official GPG key
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  # Add the stable Docker apt repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} \
$(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  log "Docker CE and Docker Compose plugin installed."
}

if ! command -v docker >/dev/null 2>&1; then
  if is_debian_based; then
    install_docker
  else
    die "Docker is not installed and auto-install is only supported on Ubuntu/Debian.
  Install: https://docs.docker.com/get-docker/"
  fi
fi

# ── Ensure Docker daemon is running ──────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  info "Docker daemon is not running — starting it now..."
  systemctl enable docker --now
  # Wait up to 30 s for the socket to become available
  for _i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || die "Docker daemon failed to start.
  Check: sudo systemctl status docker"
  log "Docker daemon started."
fi

# ── Ensure Docker Compose v2 plugin is available ─────────────────────────────
if ! docker compose version >/dev/null 2>&1; then
  if is_debian_based; then
    info "Docker Compose plugin not found — installing..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin
    log "Docker Compose plugin installed."
  else
    die "Docker Compose v2 is not installed.
  Install: https://docs.docker.com/compose/install/"
  fi
fi

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

# ── Host-nginx mode detection ─────────────────────────────────────────────────
# When USE_HOST_NGINX=1 the host-level (system) nginx acts as the TLS
# front-door and proxies to the Docker app container on port 8080.
# This is required when another service already binds port 80 on the host
# (e.g. a pre-existing system nginx, Apache, or another Docker container),
# preventing the bundled Docker nginx service from starting.
USE_HOST_NGINX="${USE_HOST_NGINX:-0}"

if [[ "$USE_HOST_NGINX" != "1" && "$SKIP_TLS" != "1" ]]; then
  # Auto-detect: if port 80 is occupied by something that is NOT docker-proxy
  # (i.e. not our own Docker nginx container), switch to host-nginx mode.
  _port80_owner=""
  if command -v ss >/dev/null 2>&1; then
    _port80_owner=$(ss -tlnp 2>/dev/null | awk '/:80[[:space:]]/' | grep -v docker-proxy | head -1 || true)
  elif command -v netstat >/dev/null 2>&1; then
    _port80_owner=$(netstat -tlnp 2>/dev/null | awk '/:80[[:space:]]/' | grep -v docker-proxy | head -1 || true)
  fi
  if [[ -n "$_port80_owner" ]]; then
    warn "Port 80 is already in use (not by Docker): $_port80_owner"
    warn "Enabling host-nginx mode to avoid port conflict."
    USE_HOST_NGINX=1
  fi
fi

if [[ "$USE_HOST_NGINX" == "1" ]]; then
  info "Host-nginx mode: system nginx will act as the TLS front-door."
  info "                 FireISP app will be accessible on localhost:8080."
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

# ── Host-nginx: install and configure system nginx ────────────────────────────
if [[ "$USE_HOST_NGINX" == "1" ]]; then
  echo ""
  echo -e "${BOLD}── Host Nginx Setup ────────────────────────────────────────────────────${RESET}"
  echo ""

  # Install nginx on the host if not already present
  if ! command -v nginx >/dev/null 2>&1; then
    apt_install nginx
    log "nginx installed."
  else
    log "nginx is already installed."
  fi

  # Create the certbot webroot (the certbot Docker container will write
  # ACME challenge files here; host nginx reads them to answer HTTP-01).
  mkdir -p "$INSTALL_DIR/nginx/certbot-www/.well-known/acme-challenge"

  # Expand the __INSTALL_DIR__ placeholder in host-nginx.conf and install it.
  HOST_NGINX_CONF_SRC="$INSTALL_DIR/nginx/host-nginx.conf"
  [[ -f "$HOST_NGINX_CONF_SRC" ]] || die "Missing $HOST_NGINX_CONF_SRC — repository may be incomplete."
  sed "s|__INSTALL_DIR__|$INSTALL_DIR|g" "$HOST_NGINX_CONF_SRC" \
    > /etc/nginx/sites-available/fireisp

  # Enable the FireISP site and disable the nginx default site to avoid
  # conflicts on port 80/443.
  ln -sf /etc/nginx/sites-available/fireisp /etc/nginx/sites-enabled/fireisp
  rm -f /etc/nginx/sites-enabled/default

  # Validate the generated nginx config.
  nginx -t || die "Generated nginx configuration is invalid.
  Check /etc/nginx/sites-available/fireisp and fix any errors."

  log "Host nginx configured (/etc/nginx/sites-available/fireisp)."

  # Schedule nginx to reload every 6 hours so it picks up renewed TLS
  # certificates without manual intervention.  Uses the root crontab.
  CRON_LINE="0 */6 * * * /usr/sbin/nginx -s reload 2>/dev/null || true"
  ( crontab -l 2>/dev/null | grep -v "nginx -s reload" ; echo "$CRON_LINE" ) | crontab -
  log "Cron job added: nginx reloads every 6 hours to pick up renewed certs."
fi

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
  if [[ "$USE_HOST_NGINX" == "1" ]]; then
    # Start host nginx now that dummy certs are in place.
    systemctl enable nginx --now || true
  fi
else
  info "Bootstrapping Let's Encrypt TLS for ${DOMAIN} ..."
  LETSENCRYPT_SCRIPT="$INSTALL_DIR/nginx/init-letsencrypt.sh"
  [[ -f "$LETSENCRYPT_SCRIPT" ]] || die "TLS bootstrap script not found: $LETSENCRYPT_SCRIPT
  The repository may be incomplete. Re-run the installer."
  # Build the flag list for the TLS bootstrap script using an array to
  # avoid word-splitting issues when flags contain no content.
  _TLS_ARGS=()
  [[ -n "${CF_API_TOKEN:-}" ]] && _TLS_ARGS+=(--cloudflare)
  [[ "$USE_HOST_NGINX" == "1" ]] && _TLS_ARGS+=(--host-nginx)
  CF_API_TOKEN="${CF_API_TOKEN:-}" DOMAIN="$DOMAIN" EMAIL="$EMAIL" \
    bash "$LETSENCRYPT_SCRIPT" "${_TLS_ARGS[@]}"
  log "Let's Encrypt certificate obtained."
fi

# ── Start the stack ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Starting FireISP ─────────────────────────────────────────────────────${RESET}"
echo ""

# In host-nginx mode include the overlay that disables the Docker nginx
# container and exposes the app on localhost:8080 for the host nginx.
if [[ "$USE_HOST_NGINX" == "1" ]]; then
  COMPOSE="docker compose -f $INSTALL_DIR/docker-compose.prod.yml -f $INSTALL_DIR/docker-compose.host-nginx.yml --env-file $ENV_FILE"
else
  COMPOSE="docker compose -f $INSTALL_DIR/docker-compose.prod.yml --env-file $ENV_FILE"
fi

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
if [[ "$USE_HOST_NGINX" == "1" ]]; then
  echo ""
  echo -e "  ${BOLD}Nginx mode${RESET}         Host nginx (system service)"
  echo -e "  ${BOLD}App port${RESET}           localhost:8080 → Docker app container"
  echo -e "  ${BOLD}Nginx config${RESET}       /etc/nginx/sites-available/fireisp"
  echo -e "  ${BOLD}Cert reload${RESET}        Cron: nginx -s reload every 6 hours"
fi
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
