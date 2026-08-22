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
#   DB_PASSWORD         MySQL app user password     (auto-generated if omitted)
#   DB_ROOT_PASSWORD    MySQL root password          (auto-generated if omitted)
#   MYSQL_REPL_PASSWORD MySQL replication password   (auto-generated if omitted)
#   REDIS_PASSWORD      Redis password               (auto-generated if omitted)
#   JWT_SECRET          JWT signing secret           (auto-generated if omitted)
#   ENCRYPTION_KEY      AES-256 key for at-rest secrets (auto-generated if omitted)
#   WG_LISTEN_PORT      NAS WireGuard UDP port (random high port if omitted)
#   WG_CLIENT_LISTEN_PORT User WireGuard UDP port (random high port if omitted)
#   ADMIN_IP_ALLOWLIST  Optional install-wide admin IPv4/CIDR override
#
# =============================================================================

set -euo pipefail

REPO_URL="https://github.com/vothalvino/fireisp5.0.git"
FIREISP_VERSION="5.0"
INSTALL_DIR="${INSTALL_DIR:-/opt/fireisp}"
ENV_FILE="$INSTALL_DIR/.env.prod"

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
    info "Docker Compose v2 not found — installing it..."
    # Docker's official apt repository calls the package
    # `docker-compose-plugin`; Ubuntu's own repository calls the same Compose
    # v2 CLI `docker-compose-v2` (including Noble 24.04 and Resolute 26.04).
    # A host with distro Docker already installed may have only the latter
    # available, so choose the package the configured repositories actually
    # provide instead of assuming Docker's repository is present.
    if [[ "$_apt_updated" -eq 0 ]]; then
      apt-get update -qq
      _apt_updated=1
    fi
    if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
      apt_install docker-compose-plugin
    elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then
      apt_install docker-compose-v2
    else
      die "Docker Compose v2 is unavailable from this host's configured repositories.
  Install it from: https://docs.docker.com/compose/install/"
    fi
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 was installed but is not usable."
    log "Docker Compose v2 installed."
  else
    die "Docker Compose v2 is not installed.
  Install: https://docs.docker.com/compose/install/"
  fi
fi

# Prompt helper: skips the prompt when the variable is already set (env or
# previous prompt) so the installer is fully non-interactive when all variables
# are supplied upfront.
prompt() {
  local var="$1" msg="$2" default="${3:-}" val=""
  if [[ -n "${!var:-}" ]]; then return; fi
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "${BOLD}${msg}${RESET} [${default}]: ")" val </dev/tty
    printf -v "$var" '%s' "${val:-${default}}"
  else
    while [[ -z "$val" ]]; do
      read -rp "$(echo -e "${BOLD}${msg}${RESET}: ")" val </dev/tty
    done
    printf -v "$var" '%s' "$val"
  fi
}

# Ask Compose to parse the env file so retries use the exact same rules as
# `docker compose up`: quotes, whitespace, comments and interpolation are all
# handled correctly. Compose 2.27.2 added `config --environment`; older Noble
# images get a compatibility path for the installer's own canonical KEY=value
# format and a precise failure for richer syntax. The target key is unset in the
# helper subprocess so a caller-supplied value cannot override the saved one.
get_env_value() {
  local file="$1" key="$2" compose_help rendered line regex value="" found=0
  compose_help="$(docker compose config --help 2>/dev/null || true)"
  if [[ "$compose_help" == *"--environment"* ]]; then
    if ! rendered="$(
      unset "$key"
      printf 'services:\n  env-reader:\n    image: scratch\n    environment:\n      FIREISP_ENV_VALUE: ${%s}\n' "$key" \
        | docker compose --project-name fireisp-env-reader --env-file "$file" -f - \
            config --environment 2>/dev/null
    )"; then
      return 2
    fi
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
        "${key}="*)
          value="${line#*=}"
          # `config --environment` represents an embedded newline as a
          # multi-line single-quoted value. Secrets and installer control
          # values must be single-line; taking only this first physical line
          # would silently change the value used by Compose.
          if [[ "$value" == \'* && "$value" != *\' ]]; then
            return 4
          fi
          found=1
          ;;
      esac
    done <<< "$rendered"
  else
    # Compose <2.27.2 cannot expose its parsed interpolation environment. Files
    # generated by this installer are deliberately simple and remain retryable;
    # a customized rich-syntax file must be handled by a newer Compose rather
    # than guessed at and potentially rotating the wrong credential.
    regex="^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*[:=]"
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
        "${key}="*)
          value="${line#*=}"
          # Raw `$`, quotes or whitespace can change meaning under Compose
          # parsing; only the installer's unambiguous form is safe here.
          if [[ "$value" == *'$'* || "$value" == *'"'* || "$value" == *"'"* \
                || "$value" =~ [[:space:]] ]]; then
            return 3
          fi
          found=1
          ;;
        *)
          # Reject even an overridden rich-syntax occurrence. Guessing which
          # duplicate assignment wins would be riskier than requiring upgrade.
          if [[ "$line" =~ $regex ]]; then
            return 3
          fi
          ;;
      esac
    done < "$file"
  fi
  [[ "$found" -eq 1 ]] || return 1
  printf '%s' "$value"
}

# Atomically append an authoritative final assignment for one key. Compose uses
# the last occurrence, so this preserves even multiline/quoted operator syntax
# byte-for-byte instead of trying to rewrite it. A non-empty fourth argument
# requests a backup; both backup and temporary names use the repository's
# ignored `.env.prod.bak-*` convention. The value is emitted only by Bash's
# printf builtin and never appears in another process's argv.
set_env_value() {
  local file="$1" key="$2" value="$3" backup_tag="${4:-}" line temp backup
  local -a lines=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    lines+=("$line")
  done < "$file"
  lines+=("${key}=${value}")

  temp="$(mktemp "${file}.bak-tmp-XXXXXX")" || die "Cannot create a secure temporary env file beside ${file}."
  chmod 600 "$temp"
  if ! {
    for line in "${lines[@]}"; do
      printf '%s\n' "$line"
    done
  } > "$temp"; then
    rm -f -- "$temp"
    die "Cannot write the repaired environment file; the original is unchanged."
  fi

  ENV_UPDATE_BACKUP=""
  if [[ -n "$backup_tag" ]]; then
    backup="${file}.bak-${backup_tag}-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
    if ! cp -p -- "$file" "$backup"; then
      rm -f -- "$temp"
      die "Cannot back up ${file}; refusing to modify it."
    fi
    chmod 600 "$backup"
    ENV_UPDATE_BACKUP="$backup"
  fi
  if ! mv -f -- "$temp" "$file"; then
    rm -f -- "$temp"
    die "Cannot atomically install the updated env file; the original remains available."
  fi
}

reuse_env_value() {
  local variable="$1" key="$2" existing status=0
  existing="$(get_env_value "$ENV_FILE" "$key")" || status=$?
  if [[ "$status" -eq 3 ]]; then
    die "Existing $ENV_FILE uses rich Compose syntax for ${key}, but this host's
  Docker Compose is older than 2.27.2. Upgrade the Compose plugin, then rerun;
  refusing to guess at a production credential."
  fi
  [[ "$status" -eq 0 && -n "$existing" ]] || die "Existing $ENV_FILE has no readable ${key} value.
  Refusing to regenerate production credentials over persistent data. Restore
  the missing value from backup. Docker Compose must also be able to parse the
  file; quoted values, whitespace, comments and interpolation are supported."
  if [[ -n "${!variable:-}" && "${!variable}" != "$existing" ]]; then
    warn "Ignoring the supplied ${variable}: an existing install keeps its saved ${key}."
  fi
  printf -v "$variable" '%s' "$existing"
}

plan_initial_bootstrap() {
  local state="$1" database_was_pristine="$2"
  RUN_INITIAL_SEED=0
  SHOW_INITIAL_ADMIN=0
  case "$state" in
    pending)  RUN_INITIAL_SEED=1; SHOW_INITIAL_ADMIN=1 ;;
    seeded)   SHOW_INITIAL_ADMIN=1 ;;
    complete) ;;
    "")
      if [[ "$database_was_pristine" == "1" ]]; then
        RUN_INITIAL_SEED=1
        SHOW_INITIAL_ADMIN=1
      fi
      ;;
  esac
}

# Exactly 32 random bytes encoded as 64 hexadecimal characters. The previous
# base64 pipeline started with only 64 characters and then deleted '/' and '+',
# so roughly 87% of generated JWT secrets were shorter than the required 64 and
# made the production process exit immediately.
gen_secret() { openssl rand -hex 32; }
INSECURE_DEFAULT_JWT_SECRET='change-me-in-production-this-default-jwt-secret-is-not-secure!!!'

# gen_pass: 24 bytes → base64 → strip non-alphanumeric → ~32 printable chars.
# Used for MySQL and Redis passwords where shell-safe characters matter.
gen_pass()   { openssl rand -base64 24 | tr -d '\n/+='; }

# Fresh installs do not advertise the repository's conventional WireGuard
# ports. These values are not secrets (WireGuard is cryptographically silent to
# unauthenticated packets), but random high ports reduce routine scan noise.
gen_udp_port() {
  local hex
  hex="$(openssl rand -hex 2)"
  echo $((20000 + (16#$hex % 40000)))
}

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

# A rerun must converge on the credentials already paired with the persistent
# MySQL volume. Load them before prompting or generating anything. This also
# preserves every operator-added setting because the env file is left intact.
REUSE_EXISTING_ENV=0
ENV_UPDATE_BACKUP=""
SAVED_BOOTSTRAP_STATE=""

# Losing .env.prod does not make an initialized MySQL volume fresh: the official
# image ignores new initialization passwords once its data directory exists.
# Refuse to invent credentials when an actual database volume/container says
# this is a recovery operation. A checkout by itself is recoverable: the first
# run may have been interrupted between `git clone` and env creation.
_INSTALL_BASENAME="${INSTALL_DIR%/}"
_INSTALL_BASENAME="${_INSTALL_BASENAME##*/}"
_COMPOSE_PROJECT_GUESS="${COMPOSE_PROJECT_NAME:-${_INSTALL_BASENAME:-fireisp}}"
_COMPOSE_PROJECT_GUESS="${_COMPOSE_PROJECT_GUESS,,}"
_COMPOSE_PROJECT_GUESS="${_COMPOSE_PROJECT_GUESS//[^a-z0-9_-]/}"
while [[ "$_COMPOSE_PROJECT_GUESS" == [-_]* ]]; do
  _COMPOSE_PROJECT_GUESS="${_COMPOSE_PROJECT_GUESS:1}"
done
_COMPOSE_PROJECT_GUESS="${_COMPOSE_PROJECT_GUESS:-fireisp}"
_DB_VOLUME_GUESS="${_COMPOSE_PROJECT_GUESS}_db_primary_data"
_DB_CONTAINER_IDS="$(docker ps -aq \
  --filter "label=com.docker.compose.project.working_dir=$INSTALL_DIR" \
  --filter "label=com.docker.compose.service=db-primary")"
if [[ ! -f "$ENV_FILE" ]] && {
    docker volume inspect "$_DB_VOLUME_GUESS" >/dev/null 2>&1 || [[ -n "$_DB_CONTAINER_IDS" ]]
  }; then
  die "Existing FireISP database state was found, but $ENV_FILE is missing.
  Refusing to generate new database/encryption credentials over persistent data.
  Restore .env.prod from backup (including any .env.prod.bak-* file).
  Only remove the old install/volume after confirming it contains no needed data."
fi

if [[ -f "$ENV_FILE" ]]; then
  REUSE_EXISTING_ENV=1
  chmod 600 "$ENV_FILE"
  info "Existing production configuration found at $ENV_FILE — reusing it."
  reuse_env_value DOMAIN DOMAIN
  reuse_env_value EMAIL CERTBOT_EMAIL
  reuse_env_value DB_PASSWORD DB_PASSWORD
  reuse_env_value DB_ROOT_PASSWORD DB_ROOT_PASSWORD
  reuse_env_value MYSQL_REPL_PASSWORD MYSQL_REPL_PASSWORD
  reuse_env_value REDIS_PASSWORD REDIS_PASSWORD
  reuse_env_value JWT_SECRET JWT_SECRET
  reuse_env_value ENCRYPTION_KEY ENCRYPTION_KEY

  # Omitted means the application's safe HS256 default. An explicitly different
  # algorithm is rejected by the runtime and must not survive installer checks.
  _JWT_ALGORITHM_STATUS=0
  _SAVED_JWT_ALGORITHM="$(get_env_value "$ENV_FILE" JWT_ALGORITHM)" || _JWT_ALGORITHM_STATUS=$?
  if [[ "$_JWT_ALGORITHM_STATUS" -eq 0 && -n "$_SAVED_JWT_ALGORITHM" \
        && "$_SAVED_JWT_ALGORITHM" != "HS256" ]]; then
    die "Existing $ENV_FILE sets JWT_ALGORITHM=${_SAVED_JWT_ALGORITHM}; production requires HS256."
  elif [[ "$_JWT_ALGORITHM_STATUS" -ge 2 ]]; then
    die "Docker Compose could not safely resolve JWT_ALGORITHM from $ENV_FILE.
  Upgrade Compose to 2.27.2 or newer if the file uses quotes/interpolation."
  fi

  _BOOTSTRAP_STATE_STATUS=0
  SAVED_BOOTSTRAP_STATE="$(get_env_value "$ENV_FILE" FIREISP_BOOTSTRAP_STATE)" \
    || _BOOTSTRAP_STATE_STATUS=$?
  if [[ "$_BOOTSTRAP_STATE_STATUS" -eq 0 ]]; then
    case "$SAVED_BOOTSTRAP_STATE" in
      pending|seeded|complete) ;;
      *) die "Existing $ENV_FILE has an invalid FIREISP_BOOTSTRAP_STATE value." ;;
    esac
  elif [[ "$_BOOTSTRAP_STATE_STATUS" -ge 2 ]]; then
    die "Docker Compose could not safely resolve FIREISP_BOOTSTRAP_STATE from $ENV_FILE.
  Upgrade Compose to 2.27.2 or newer if the file uses quotes/interpolation."
  fi

  # Versions of install.sh before this fix generated a 64-character base64
  # string and then deleted '/' and '+'. Most results were therefore too short
  # for the current production validator. The runtime also rejects its exact
  # public development default. Repairing either unusable value may expire
  # sessions from an older permissive build, but DB_PASSWORD and ENCRYPTION_KEY
  # remain byte-for-byte unchanged and the original env file is backed up.
  if [[ "${#JWT_SECRET}" -ne 64 || "$JWT_SECRET" == "$INSECURE_DEFAULT_JWT_SECRET" ]]; then
    warn "The saved JWT_SECRET cannot be used by the production runtime."
    JWT_SECRET="$(gen_secret)"
    set_env_value "$ENV_FILE" JWT_SECRET "$JWT_SECRET" before-jwt-repair
    log "Repaired the invalid legacy JWT_SECRET without rotating other credentials."
    info "Original environment backed up at $ENV_UPDATE_BACKUP"
  fi
else
  SAVED_BOOTSTRAP_STATE="pending"
fi

prompt DOMAIN "Public domain name (e.g. isp.example.com)"
prompt EMAIL  "Admin email address (used for Let's Encrypt and first-run account)"

SKIP_TLS="${SKIP_TLS:-0}"
if [[ "$SKIP_TLS" == "1" ]]; then
  warn "SKIP_TLS=1 — a self-signed certificate will be used (not trusted by browsers)."
else
  info "TLS: Let's Encrypt certificate will be obtained for ${DOMAIN}."
  info "     The domain must resolve to this server's public IP before continuing."
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
  # Use :[[:space:]] to anchor the match so we do not accidentally match
  # port 8080 (which would appear as ":8080 ") — the target pattern is
  # specifically ":80 " (colon-80-space) as formatted by ss and netstat.
  _port80_owner=""
  if command -v ss >/dev/null 2>&1; then
    _port80_owner=$(ss -tlnp 2>/dev/null | awk '$4 ~ /:80$/ || $4 ~ /:80 /' | grep -v docker-proxy | head -1 || true)
  elif command -v netstat >/dev/null 2>&1; then
    _port80_owner=$(netstat -tlnp 2>/dev/null | awk '$4 ~ /:80$/ || $4 ~ /:80 /' | grep -v docker-proxy | head -1 || true)
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
if [[ "$REUSE_EXISTING_ENV" == "0" ]]; then
  : "${ADMIN_PASSWORD:=$(gen_pass)}"
  : "${WG_LISTEN_PORT:=$(gen_udp_port)}"
  : "${WG_CLIENT_LISTEN_PORT:=$(gen_udp_port)}"
  while [[ "$WG_CLIENT_LISTEN_PORT" == "$WG_LISTEN_PORT" ]]; do
    WG_CLIENT_LISTEN_PORT="$(gen_udp_port)"
  done
  for _WG_PORT in "$WG_LISTEN_PORT" "$WG_CLIENT_LISTEN_PORT"; do
    [[ "$_WG_PORT" =~ ^[0-9]+$ ]] \
      && (( 10#$_WG_PORT >= 1024 && 10#$_WG_PORT <= 65535 )) \
      || die "WireGuard UDP ports must be distinct integers between 1024 and 65535."
  done
  [[ "$WG_CLIENT_LISTEN_PORT" != "$WG_LISTEN_PORT" ]] \
    || die "WG_LISTEN_PORT and WG_CLIENT_LISTEN_PORT must be different."
fi
# ADMIN_PASSWORD is the initial password for the seeded admin account.
# It is hashed by bcrypt inside seed.js before being written to the database;
# the plaintext is never stored in the DB or in the application logs.

# Fail before cloning, TLS issuance, or container creation when an explicitly
# supplied/manual value cannot pass the same production checks as the app. An
# encryption key is never auto-repaired: changing it on an established install
# would make encrypted database credentials unreadable.
[[ "${#JWT_SECRET}" -eq 64 && "$JWT_SECRET" != "$INSECURE_DEFAULT_JWT_SECRET" ]] \
  || die "JWT_SECRET must be a unique 64-character value, not the public development default."
[[ "$ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]] || die "ENCRYPTION_KEY must be exactly 64 hexadecimal characters.
  Restore an established install's original key from backup; never generate a replacement over existing data."

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

if [[ "$REUSE_EXISTING_ENV" == "1" ]]; then
  # Never truncate an existing secrets file. Besides preserving customization,
  # this is what keeps MySQL's initialized credentials aligned with the app on
  # a retry after an interrupted installation.
  chmod 600 "$ENV_FILE"
  log "Existing .env.prod preserved."
else
  # Restrictive before the first byte is written. If the process is interrupted
  # during the heredoc, the real path remains absent and the ignored 0600 temp
  # can never be mistaken for a complete config on retry.
  _ENV_UMASK="$(umask)"
  umask 077
  _NEW_ENV_TEMP="$(mktemp "${ENV_FILE}.bak-tmp-XXXXXX")" \
    || die "Cannot create a secure temporary environment file."
  cat > "$_NEW_ENV_TEMP" <<ENVEOF
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

# Deployment topology selected by the installer. redeploy.sh reads this so an
# install using host nginx never later tries to bind a Docker nginx to 80/443.
FIREISP_HOST_NGINX=${USE_HOST_NGINX}

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

# ---- Admin IP allowlist ------------------------------------------------------
# Optional install-wide override. Leave empty to configure and activate the
# per-organization allowlist later in Security & Access Control.
ADMIN_IP_ALLOWLIST=${ADMIN_IP_ALLOWLIST:-}

# ---- Admin account (generated at install time) --------------------------------
# Plaintext initial password for the admin@demo-isp.com account.
# seed.js reads this, hashes it with bcrypt, and stores only the hash in the DB.
# Change this password in the web UI after your first login.
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Installer bootstrap state. `pending` makes an interrupted post-migration run
# resume the idempotent initial seed; install.sh advances this to `seeded`, then
# `complete` only after it has displayed the one-time login instructions.
FIREISP_BOOTSTRAP_STATE=pending

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

# ---- Install operator --------------------------------------------------------
# Who may change install-wide settings (ops alerts, map tiles, WireGuard), manage
# poller nodes, and use the update/deploy controls. Comma-separated user IDs.
#
# Leave empty: the installer seeds this onto the admin account it creates, and
# an upgrade grants it to your existing admin(s). Set it only to move the
# capability to a different account — see "The install operator" in
# docs/deployment.md. IDs, not emails: an email is editable inside the app.
INSTALL_OPERATOR_USER_IDS=

# ---- WireGuard hub -----------------------------------------------------------
# Enable/disable from Settings in the web GUI. Fresh installs receive distinct
# random high UDP ports; these values are displayed in that same settings row.
# This false marker tells the first startup this is a fresh, disabled install;
# after that, the database-backed GUI setting is authoritative.
WG_SERVER_ENABLED=false
WG_LISTEN_PORT=${WG_LISTEN_PORT}
WG_CLIENT_LISTEN_PORT=${WG_CLIENT_LISTEN_PORT}
WG_SERVER_SUBNET=10.255.0.0/16
WG_CLIENT_SUBNET=10.99.0.0/16

# ---- Optional: Sentry error tracking ----------------------------------------
# SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
ENVEOF

  chmod 600 "$_NEW_ENV_TEMP"
  mv -f -- "$_NEW_ENV_TEMP" "$ENV_FILE"
  umask "$_ENV_UMASK"
  log ".env.prod written to $ENV_FILE"
fi

# Install management commands as soon as the checkout and production
# environment exist. These used to be installed only after app readiness, so
# an interrupted install could leave a usable/recovered stack with the exact
# advertised command (`sudo redeploy`) missing.
FIREISP_BIN="/usr/local/bin/fireisp"
info "Installing fireisp CLI wrapper at $FIREISP_BIN ..."

if [[ "$USE_HOST_NGINX" == "1" ]]; then
  _COMPOSE_CMD="docker compose -f $INSTALL_DIR/docker-compose.prod.yml -f $INSTALL_DIR/docker-compose.host-nginx.yml --env-file $ENV_FILE"
else
  _COMPOSE_CMD="docker compose -f $INSTALL_DIR/docker-compose.prod.yml --env-file $ENV_FILE"
fi

cat > "$FIREISP_BIN" <<WRAPEOF
#!/usr/bin/env bash
# FireISP 5.0 management wrapper — generated by install.sh
# Usage: fireisp <docker compose subcommand>
#   fireisp logs -f
#   fireisp ps
#   fireisp restart
#   fireisp down
#   fireisp pull && fireisp up -d
#   fireisp exec app bash
exec ${_COMPOSE_CMD} "\$@"
WRAPEOF

chmod +x "$FIREISP_BIN"
log "fireisp CLI wrapper installed. Run 'fireisp --help' to get started."

# A wrapper, not a copy: every invocation executes the redeploy logic from the
# current checkout. Pinning FIREISP_DIR here also survives sudo's default
# environment reset and keeps non-default install paths working.
REDEPLOY_BIN="/usr/local/bin/redeploy"
if [[ -f "$INSTALL_DIR/redeploy.sh" ]]; then
  info "Installing redeploy command at $REDEPLOY_BIN ..."
  cat > "$REDEPLOY_BIN" <<REDEPLOYEOF
#!/usr/bin/env bash
# FireISP 5.0 redeploy wrapper — generated by install.sh
#   sudo redeploy              # deploy the current main
#   sudo redeploy <commit-sha> # roll back to an earlier published build
exec env FIREISP_DIR="$INSTALL_DIR" "$INSTALL_DIR/redeploy.sh" "\$@"
REDEPLOYEOF
  chmod +x "$REDEPLOY_BIN"
  log "redeploy installed. Update any time with: sudo redeploy"
else
  warn "redeploy.sh not found in $INSTALL_DIR — update manually with:"
  warn "  git -C $INSTALL_DIR pull && $_COMPOSE_CMD pull && $_COMPOSE_CMD up -d"
fi

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

  # Expand the __INSTALL_DIR__ placeholder in host-nginx.conf and install it
  # into conf.d/ rather than sites-available/ because this file contains
  # http-level directives (upstream, limit_req_zone, server{}) that must be
  # included inside http{}, and Ubuntu's nginx.conf includes conf.d/*.conf
  # inside its http{} block.
  HOST_NGINX_CONF_SRC="$INSTALL_DIR/nginx/host-nginx.conf"
  [[ -f "$HOST_NGINX_CONF_SRC" ]] || die "Missing $HOST_NGINX_CONF_SRC — repository may be incomplete."
  sed "s|__INSTALL_DIR__|$INSTALL_DIR|g" "$HOST_NGINX_CONF_SRC" \
    > /etc/nginx/conf.d/fireisp.conf

  # Disable the nginx default site to avoid conflicts on port 80/443.
  rm -f /etc/nginx/sites-enabled/default

  # Validate the generated nginx config.
  nginx -t || die "Generated nginx configuration is invalid.
  Check /etc/nginx/conf.d/fireisp.conf and fix any errors."

  log "Host nginx configured (/etc/nginx/conf.d/fireisp.conf)."

  # Schedule nginx to reload every 6 hours so it picks up renewed TLS
  # certificates without manual intervention.  Uses the root crontab.
  # A unique comment marker is used so we can safely remove or update this
  # entry without accidentally removing unrelated crontab lines.
  CRON_MARKER="# fireisp-nginx-reload"
  CRON_LINE="0 */6 * * * /usr/sbin/nginx -s reload 2>/dev/null || true  $CRON_MARKER"
  ( crontab -l 2>/dev/null | grep -v "$CRON_MARKER" ; echo "$CRON_LINE" ) | crontab -
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
  [[ "$USE_HOST_NGINX" == "1" ]] && _TLS_ARGS+=(--host-nginx)
  # Run the TLS bootstrap script.  If it fails (e.g. domain DNS is not yet
  # pointing to this server, or a network error), we fall back to a
  # temporary self-signed certificate so containers can still start.
  # The real certificate can be obtained later by running init-letsencrypt.sh
  # manually once DNS is in place.
  if DOMAIN="$DOMAIN" EMAIL="$EMAIL" \
       bash "$LETSENCRYPT_SCRIPT" "${_TLS_ARGS[@]}"; then
    log "Let's Encrypt certificate obtained."
  else
    warn "Let's Encrypt TLS bootstrap failed."
    warn "This usually means ${DOMAIN} does not yet resolve to this server's IP,"
    warn "or that port 80 is not reachable from the internet."
    warn ""
    warn "FireISP will start with a temporary self-signed certificate."
    warn "Once DNS is in place, obtain a real certificate by running:"
    warn "  DOMAIN=${DOMAIN} EMAIL=${EMAIL} bash ${LETSENCRYPT_SCRIPT}"
    warn ""
    # Clean up any partial nginx container left by the failed bootstrap.
    # `rm -sf` stops and removes the container in a single atomic operation.
    docker compose -f "$INSTALL_DIR/docker-compose.prod.yml" \
      rm -sf nginx >/dev/null 2>&1 || true
    # Restore production nginx.conf in case the bootstrap script swapped it
    # but did not restore it (e.g. it was killed before the EXIT trap fired).
    _NGINX_CONF_BACKUP="$INSTALL_DIR/nginx/.nginx.conf.bootstrap-backup"
    if [[ -f "$_NGINX_CONF_BACKUP" ]]; then
      mv -f "$_NGINX_CONF_BACKUP" "$INSTALL_DIR/nginx/nginx.conf"
      info "Restored production nginx.conf from bootstrap backup."
    fi
    # Create a fallback self-signed certificate.  Errors are shown so the
    # user can diagnose disk-space or permission problems.
    mkdir -p "$INSTALL_DIR/nginx/certs"
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout "$INSTALL_DIR/nginx/certs/privkey.pem" \
      -out    "$INSTALL_DIR/nginx/certs/fullchain.pem" \
      -subj   "/CN=${DOMAIN}" 2>&1 | grep -v "^Generating" || true
    log "Fallback self-signed certificate created."
    if [[ "$USE_HOST_NGINX" == "1" ]]; then
      systemctl enable nginx --now || true
    fi
  fi
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

# Pulls the published, Trivy-scanned image rather than compiling here. A first
# install therefore needs no build toolchain headroom on the target box — which
# matters, because the frontend build alone peaks around 1.43 GB RSS and the
# documented minimum for this stack is 2 GB total.
#
# The image is published for linux/amd64 and linux/arm64, which covers every
# mainstream VPS (including Ampere, Graviton and Hetzner CAX). Anything else —
# 32-bit ARM, RISC-V — has no published image and builds from source, which is
# what this installer always used to do.
#
# Checked BEFORE pulling, because the TLS certificate has already been issued by
# this point: letting `set -e` abort on an unmatched manifest would send the
# operator into a retry loop that burns Let's Encrypt's duplicate-certificate
# rate limit (5/week) on a problem no retry can fix.
_ARCH="$(uname -m)"
if [[ "$_ARCH" == "x86_64" || "$_ARCH" == "amd64" || "$_ARCH" == "aarch64" || "$_ARCH" == "arm64" ]]; then
  info "Pulling images (first run downloads ~400 MB)..."
  if ! $COMPOSE pull; then
    warn ""
    warn "Could not pull the application image."
    warn ""
    warn "If the error above says 'denied' or 'unauthorized', the GitHub package"
    warn "is private — GitHub makes container packages private by DEFAULT, even"
    warn "for a public repository. Either make it public:"
    warn "  GitHub → Packages → fireisp5.0 → Package settings → Change visibility"
    warn "or authenticate this host:"
    warn "  echo \"\$GHCR_PAT\" | docker login ghcr.io -u <github-username> --password-stdin"
    warn ""
    warn "Then re-run this installer. Your .env.prod and TLS certificate are"
    warn "already in place and will be reused — nothing is lost."
    die "Image pull failed."
  fi
else
  warn "Architecture '${_ARCH}' detected — no image is published for it"
  warn "(amd64 and arm64 are). Building from source instead. This needs real"
  warn "memory (the frontend build peaks around 1.43 GB) and takes several"
  warn "minutes."
  COMPOSE="$COMPOSE -f $INSTALL_DIR/docker-compose.build.yml"
  $COMPOSE build app
fi

# Bring up dependencies only. The application must not start against a pristine
# schema: its readiness contract (and the SNMP listener it covers) intentionally
# requires the latest migrations. `docker compose run` below does not publish
# the app's fixed UDP ports, so migrations and seed can run without exposing a
# partially initialized service.
info "Starting database and Redis dependencies..."
$COMPOSE up -d db-primary redis

# Stop a leftover app from an interrupted pre-fix install before migrating. On
# a truly fresh install there is no app container and Compose treats this as an
# idempotent no-op.
$COMPOSE stop -t 30 app

# ── Wait for database ─────────────────────────────────────────────────────────
# 30 iterations × 10 s = 300 s (5 minutes) maximum wait.
MAX_DB_WAIT_ITERATIONS=30
DB_WAS_PRISTINE=0
info "Waiting for MySQL to be ready (up to 5 minutes)..."
for i in $(seq 1 "$MAX_DB_WAIT_ITERATIONS"); do
  # The password is expanded INSIDE the container (single quotes are the point)
  # from the env compose already gave it. The old form put DB_ROOT_PASSWORD in
  # the HOST process's argv, where /proc/<pid>/cmdline (mode 0444) exposed it to
  # every local account for up to the full 5-minute wait. Same rule as the seed
  # step below and deploy-agent.sh: no secret ever reaches host argv. TCP is
  # explicit so the probe cannot mistake MySQL's temporary socket-only bootstrap
  # server for the final initialized instance.
  _DB_CHECK_OUTPUT=""
  if _DB_CHECK_OUTPUT="$($COMPOSE exec -T db-primary \
      sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --connect-timeout=5 --protocol=TCP -h 127.0.0.1 -u "$MYSQL_USER" "$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()"' \
      2>&1)"; then
    _DB_TABLE_COUNT="${_DB_CHECK_OUTPUT##*$'\n'}"
    [[ "$_DB_TABLE_COUNT" =~ ^[0-9]+$ ]] || die "MySQL returned an unexpected readiness result.
  Check logs with: $COMPOSE logs db-primary"
    if [[ "$_DB_TABLE_COUNT" -eq 0 ]]; then
      DB_WAS_PRISTINE=1
    fi
    log "Database is ready."
    break
  fi
  if [[ "$_DB_CHECK_OUTPUT" == *"Access denied"* ]]; then
    die "MySQL rejected the application database credentials saved in $ENV_FILE.
  If the old installer was rerun, it may have overwritten .env.prod while the
  database retained its original password. Restore the original .env.prod from
  backup. Reinitialize volumes only when this install is confirmed disposable."
  fi
  if [[ $i -eq $MAX_DB_WAIT_ITERATIONS ]]; then
    die "Database did not accept authenticated queries within 5 minutes.
  Check logs with: $COMPOSE logs db-primary"
  fi
  sleep 10
done

# ── Database migrations ────────────────────────────────────────────────────────
info "Running database migrations before application startup..."
if ! $COMPOSE run --rm -T --no-deps -e MIGRATE_ISOLATED_TENANTS=true \
    app node src/scripts/migrate.js; then
  die "Database migration failed; the application remains stopped.
  Fix the reported database error and rerun the installer. If MySQL reported
  access denied after an old installer retry, restore the original .env.prod."
fi
log "Migrations applied."

# ── Resume or complete first-install bootstrap ────────────────────────────────
# seed.js is a development/demo fixture with fixed IDs, so an established ISP
# must never run it again. New env files carry a durable `pending` marker: if the
# installer is interrupted after migrations or halfway through the idempotent
# seed, the retry resumes it. Legacy env files with no marker are seeded only
# when the database was truly empty before migration.
plan_initial_bootstrap "$SAVED_BOOTSTRAP_STATE" "$DB_WAS_PRISTINE"

# A resumed bootstrap needs a discoverable initial password. Load it only for
# that narrow case (never for an established install). If a hand-written env has
# none and its database is still uninitialized, persist a new one atomically
# before seed.js hashes it. The value never appears in another process's argv.
if [[ "$RUN_INITIAL_SEED" == "1" || "$SAVED_BOOTSTRAP_STATE" == "seeded" ]]; then
  _ADMIN_PASSWORD_STATUS=0
  _SAVED_ADMIN_PASSWORD="$(get_env_value "$ENV_FILE" ADMIN_PASSWORD)" \
    || _ADMIN_PASSWORD_STATUS=$?
  if [[ "$_ADMIN_PASSWORD_STATUS" -eq 0 && -z "$_SAVED_ADMIN_PASSWORD" ]]; then
    _ADMIN_PASSWORD_STATUS=1
  fi
  if [[ "$_ADMIN_PASSWORD_STATUS" -eq 0 && -n "$_SAVED_ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$_SAVED_ADMIN_PASSWORD"
  elif [[ "$RUN_INITIAL_SEED" == "1" && "$_ADMIN_PASSWORD_STATUS" -eq 1 ]]; then
    : "${ADMIN_PASSWORD:=$(gen_pass)}"
    set_env_value "$ENV_FILE" ADMIN_PASSWORD "$ADMIN_PASSWORD"
    log "Generated and securely saved an initial administrator password."
  elif [[ "$SAVED_BOOTSTRAP_STATE" == "seeded" && "$_ADMIN_PASSWORD_STATUS" -eq 1 ]]; then
    SHOW_INITIAL_ADMIN=0
    warn "Initial bootstrap finished previously, but ADMIN_PASSWORD is absent from $ENV_FILE."
    warn "Use the normal password-reset flow; no stored credential was changed."
  else
    die "Cannot read ADMIN_PASSWORD from $ENV_FILE; refusing to seed an unreachable administrator."
  fi
fi

if [[ "$RUN_INITIAL_SEED" == "1" ]]; then
  info "Seeding the initial administrator and demo data..."
  # The app service receives ADMIN_PASSWORD through its 0600 env_file.
  $COMPOSE run --rm -T --no-deps app node src/scripts/seed.js
  set_env_value "$ENV_FILE" FIREISP_BOOTSTRAP_STATE seeded
  SAVED_BOOTSTRAP_STATE="seeded"
  log "Initial data loaded."
else
  info "Existing application data detected — skipping the demo seed."
fi

# Only now expose the application listeners and reverse proxy.
info "Starting the complete FireISP stack..."
$COMPOSE up -d
log "Containers started."

# ── Wait for app readiness ─────────────────────────────────────────────────────
# Use Node, which is guaranteed to exist in the runtime image. `wget` disappeared
# when the image moved from Alpine to bookworm-slim and made the old probe fail
# silently. Readiness (not mere process liveness) verifies DB, Redis, schema, and
# the enabled SNMP listener before the installer reports success.
MAX_APP_WAIT_ITERATIONS=30  # 30 × 2 s = 60 seconds
info "Waiting for the app readiness probe (up to 60 seconds)..."
for i in $(seq 1 "$MAX_APP_WAIT_ITERATIONS"); do
  if $COMPOSE exec -T app node -e \
      "fetch('http://127.0.0.1:3000/health/ready', { signal: AbortSignal.timeout(5000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
      >/dev/null 2>&1; then
    log "App container is ready."
    break
  fi
  if [[ $i -eq $MAX_APP_WAIT_ITERATIONS ]]; then
    die "App readiness probe is still failing after 60 seconds.
  Check logs with: $COMPOSE logs --tail=100 app"
  fi
  sleep 2
done


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
echo -e "  ${BOLD}CLI wrapper${RESET}        $FIREISP_BIN"
if [[ "$USE_HOST_NGINX" == "1" ]]; then
  echo ""
  echo -e "  ${BOLD}Nginx mode${RESET}         Host nginx (system service)"
  echo -e "  ${BOLD}App port${RESET}           localhost:8080 → Docker app container"
  echo -e "  ${BOLD}Nginx config${RESET}       /etc/nginx/conf.d/fireisp.conf"
  echo -e "  ${BOLD}Cert reload${RESET}        Cron: nginx -s reload every 6 hours"
fi
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "   1. Open https://${DOMAIN} in your browser"
if [[ "$SHOW_INITIAL_ADMIN" == "1" ]]; then
  echo -e "   2. Log in with the credentials below, then immediately change the password"
  echo -e "      ${BOLD}Admin email   :${RESET} admin@demo-isp.com"
  echo -e "      ${BOLD}Admin password:${RESET} ${ADMIN_PASSWORD}"
  echo -e "      ${YELLOW}(Also stored in ${ENV_FILE} — keep that file private)${RESET}"
else
  echo -e "   2. Existing administrator credentials were left unchanged"
  echo -e "      (use the current password or the normal password-reset flow)"
fi

# Mark one-time bootstrap instructions complete only after printing them. If an
# SSH session dies earlier, `seeded` survives and the next run displays the
# saved initial credential without rerunning demo data.
if [[ "$SAVED_BOOTSTRAP_STATE" == "seeded" ]]; then
  set_env_value "$ENV_FILE" FIREISP_BOOTSTRAP_STATE complete
  SAVED_BOOTSTRAP_STATE="complete"
fi
echo -e "   3. Configure SMTP in Settings → Organization → Email"
echo -e "   4. Fill in your ISP organization details"
echo ""
echo -e "  ${BOLD}Management commands (via the fireisp wrapper):${RESET}"
echo -e "   fireisp logs -f               # stream all container logs"
echo -e "   fireisp ps                    # show container status"
echo -e "   fireisp stop                  # stop containers (keeps data volumes)"
echo -e "   fireisp down                  # stop and remove containers"
echo -e "   fireisp restart               # restart all containers"
echo -e "   fireisp pull && fireisp up -d # fetch the published image and start"
echo -e "   fireisp exec app bash         # open a shell in the app container"
echo ""
echo -e "  ${BOLD}Update FireISP:${RESET}"
echo -e "   sudo redeploy                 # pull main + the matching image, migrate, verify"
echo ""
echo -e "  ${YELLOW}${BOLD}⚠  Store $ENV_FILE securely — it contains all generated credentials.${RESET}"
echo -e "  ${YELLOW}${BOLD}⚠  Admin IP protection is initially off; configure and activate it in Security & Access Control.${RESET}"
echo ""
