#!/bin/bash

# 1. Colors for feedback
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

generate_hex_secret() {
    if command -v openssl &> /dev/null; then
        openssl rand -hex 32
    else
        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    fi
}

is_hex_64() {
    printf '%s' "$1" | grep -Eq '^[0-9a-fA-F]{64}$'
}

is_placeholder_or_empty() {
    [ -z "$1" ] || [[ "$1" == CHANGE_ME* ]] || [[ "$1" == change-me* ]]
}

get_env_value() {
    local file="$1"
    local key="$2"
    grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

# Write KEY=value into an env file WITHOUT the value ever becoming a command
# argument.
#
# This used to run `sed -i "s|^KEY=.*|KEY=${value}|"`, which execs sed with the
# secret in its argv — and /proc/<pid>/cmdline is mode 0444, so every local
# account could read it while sed ran. Every generated secret went through here:
# JWT_SECRET, ENCRYPTION_KEY, and the DB / root / replication / Redis passwords.
#
# Bash builtins only (read, printf, string tests). A builtin does not fork, so
# nothing appears in any process table. That also removes the old landmine where
# a value containing `|`, `&` or `\` was interpreted as sed replacement syntax
# and silently corrupted the written secret.
#
# Substitution semantics are preserved exactly: every line matching `KEY=` is
# replaced; failing that, every `# KEY=` / `#KEY=` line is uncommented and set;
# failing that, the setting is appended.
set_env_value() {
    local file="$1"
    local key="$2"
    local value="$3"
    local line out="" found=0 mode="set"

    if ! grep -qE "^${key}=" "$file"; then
        if grep -qE "^# ?${key}=" "$file"; then
            mode="uncomment"
        else
            printf '\n%s=%s\n' "$key" "$value" >> "$file"
            return 0
        fi
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        case "$mode:$line" in
            set:"${key}="*)              line="${key}=${value}"; found=1 ;;
            uncomment:"# ${key}="*)      line="${key}=${value}"; found=1 ;;
            uncomment:"#${key}="*)       line="${key}=${value}"; found=1 ;;
        esac
        out+="${line}"$'\n'
    done < "$file"

    # Never truncate a file holding DB_PASSWORD/ENCRYPTION_KEY on a logic error.
    if [ "$found" -ne 1 ] || [ -z "$out" ]; then
        echo "set_env_value: refusing to rewrite $file (no ${key} line matched)" >&2
        return 1
    fi

    # Truncate-in-place rather than mv: mv would replace the inode and hand the
    # file the umask's mode, turning a 0600 secrets file world-readable.
    printf '%s' "$out" > "$file"
}

ensure_hex_secret() {
    local file="$1"
    local key="$2"
    local label="$3"
    local current
    current=$(get_env_value "$file" "$key")
    if is_hex_64 "$current"; then
        echo "$label already configured with a 64-character local secret; keeping existing value."
        return 1
    fi

    echo "Generating secure $label..."
    set_env_value "$file" "$key" "$(generate_hex_secret)"
    return 0
}

ensure_password() {
    local file="$1"
    local key="$2"
    local label="$3"
    local current
    current=$(get_env_value "$file" "$key")
    if ! is_placeholder_or_empty "$current"; then
        echo "$label already configured; keeping existing value."
        return 1
    fi

    echo "Generating random $label..."
    set_env_value "$file" "$key" "$(generate_hex_secret | cut -c1-40)"
    return 0
}

# 2. Parse flags
PROD=false
for arg in "$@"; do
    case "$arg" in
        --prod) PROD=true ;;
    esac
done

echo -e "${BLUE}Starting FireISP Automated Setup...${NC}"

if [ "$PROD" = true ]; then
    # ------------------------------------------------------------------ PROD --
    ENV_FILE=".env.prod"
    ENV_EXAMPLE=".env.prod.example"

    # 3. Handle .env.prod file creation
    if [ ! -f "$ENV_FILE" ]; then
        echo "Creating $ENV_FILE from $ENV_EXAMPLE..."
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
    else
        echo "$ENV_FILE already exists, skipping creation."
    fi

    # 4. Generate secrets for production. Existing valid secrets are never rotated
    # automatically because doing so would invalidate sessions or make encrypted
    # database secrets unreadable.
    ensure_hex_secret "$ENV_FILE" "JWT_SECRET" "JWT_SECRET"
    set_env_value "$ENV_FILE" "JWT_ALGORITHM" "HS256"

    ensure_hex_secret "$ENV_FILE" "ENCRYPTION_KEY" "ENCRYPTION_KEY"

    ensure_password "$ENV_FILE" "DB_PASSWORD" "DB_PASSWORD"
    ensure_password "$ENV_FILE" "DB_ROOT_PASSWORD" "DB_ROOT_PASSWORD"
    ensure_password "$ENV_FILE" "MYSQL_REPL_PASSWORD" "MYSQL_REPL_PASSWORD"

    if ensure_password "$ENV_FILE" "REDIS_PASSWORD" "REDIS_PASSWORD"; then
        NEW_REDIS_PASS=$(get_env_value "$ENV_FILE" "REDIS_PASSWORD")
        # Update the embedded password inside REDIS_URL (template: redis://:placeholder@host)
        if grep -qE '^REDIS_URL=redis://:[^@]*@' "$ENV_FILE"; then
            sed -i "s|^REDIS_URL=redis://:[^@]*@|REDIS_URL=redis://:$NEW_REDIS_PASS@|" "$ENV_FILE"
        else
            set_env_value "$ENV_FILE" "REDIS_URL" "redis://:$NEW_REDIS_PASS@redis:6379"
        fi
    fi

    # 5. Install dependencies
    if command -v pnpm &> /dev/null; then
        echo -e "${GREEN}Installing dependencies with pnpm...${NC}"
        pnpm install
    else
        echo "pnpm not found. Falling back to npm install..."
        npm install
    fi

    # 6. Final message
    echo -e "------------------------------------------------"
    echo -e "${GREEN}Production Setup Complete!${NC}"
    echo -e "Your $ENV_FILE is configured with secure secrets."
    echo -e "Remember to fill in domain, SMTP, third-party keys, and ADMIN_IP_ALLOWLIST."
    echo -e "Run ${BLUE}docker compose -f docker-compose.prod.yml --env-file .env.prod up -d${NC} to start."
    echo -e "------------------------------------------------"

else
    # ------------------------------------------------------------------ DEV ---
    ENV_FILE=".env"

    # 3. Handle .env file creation
    if [ ! -f "$ENV_FILE" ]; then
        echo "Creating $ENV_FILE from .env.example..."
        cp .env.example "$ENV_FILE"
    else
        echo "$ENV_FILE already exists, skipping creation."
    fi

    # 4. Generate secure local secrets. Existing valid secrets are never rotated
    # automatically because doing so would invalidate sessions or make encrypted
    # database secrets unreadable.
    ensure_hex_secret "$ENV_FILE" "JWT_SECRET" "JWT_SECRET"
    set_env_value "$ENV_FILE" "JWT_ALGORITHM" "HS256"

    ensure_hex_secret "$ENV_FILE" "ENCRYPTION_KEY" "ENCRYPTION_KEY"

    # 5. Generate random Database Password
    ensure_password "$ENV_FILE" "DB_PASSWORD" "DB_PASSWORD"

    # 6. Install dependencies
    if command -v pnpm &> /dev/null; then
        echo -e "${GREEN}Installing dependencies with pnpm...${NC}"
        pnpm install
    else
        echo "pnpm not found. Falling back to npm install..."
        npm install
    fi

    # 7. Final message
    echo -e "------------------------------------------------"
    echo -e "${GREEN}Setup Complete!${NC}"
    echo -e "Your .env is now configured with secure secrets."
    echo -e "Run ${BLUE}pnpm dev${NC} to start the server."
    echo -e "------------------------------------------------"
fi
