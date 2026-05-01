#!/bin/bash

# 1. Colors for feedback
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

    # 4. Generate secrets for production
    echo "Generating secure JWT_SECRET..."
    NEW_JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" "$ENV_FILE"

    echo "Generating secure ENCRYPTION_KEY..."
    NEW_ENC_KEY=$(openssl rand -hex 32)
    sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$NEW_ENC_KEY/" "$ENV_FILE"

    echo "Generating random DB_PASSWORD..."
    NEW_DB_PASS=$(openssl rand -hex 20)
    sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$NEW_DB_PASS/" "$ENV_FILE"

    echo "Generating random DB_ROOT_PASSWORD..."
    NEW_DB_ROOT_PASS=$(openssl rand -hex 20)
    sed -i "s/^DB_ROOT_PASSWORD=.*/DB_ROOT_PASSWORD=$NEW_DB_ROOT_PASS/" "$ENV_FILE"

    echo "Generating random MYSQL_REPL_PASSWORD..."
    NEW_REPL_PASS=$(openssl rand -hex 20)
    sed -i "s/^MYSQL_REPL_PASSWORD=.*/MYSQL_REPL_PASSWORD=$NEW_REPL_PASS/" "$ENV_FILE"

    echo "Generating random REDIS_PASSWORD..."
    NEW_REDIS_PASS=$(openssl rand -hex 20)
    sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$NEW_REDIS_PASS/" "$ENV_FILE"
    # Update the embedded password inside REDIS_URL (template: redis://:placeholder@host)
    sed -i "s|^REDIS_URL=redis://:[^@]*@|REDIS_URL=redis://:$NEW_REDIS_PASS@|" "$ENV_FILE"

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
    echo -e "Remember to fill in domain, SMTP, and third-party keys."
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

    # 4. Generate secure 64-character JWT_SECRET (512-bit)
    # This satisfies the HS256 requirement that caused your crash
    echo "Generating secure JWT_SECRET..."
    NEW_JWT_SECRET=$(openssl rand -hex 32)
    # Replaces the placeholder in .env with the new secret
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" "$ENV_FILE"

    # 5. Generate random Database Password
    echo "Generating random DB_PASSWORD..."
    NEW_DB_PASS=$(openssl rand -base64 12)
    sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$NEW_DB_PASS/" "$ENV_FILE"

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