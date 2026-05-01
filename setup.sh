#!/bin/bash

# 1. Colors for feedback
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting FireISP Automated Setup...${NC}"

# 2. Handle .env file creation
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
else
    echo ".env already exists, skipping creation."
fi

# 3. Generate secure 64-character JWT_SECRET (512-bit)
# This satisfies the HS256 requirement that caused your crash
echo "Generating secure JWT_SECRET..."
NEW_JWT_SECRET=$(openssl rand -hex 32)
# Replaces the placeholder in .env with the new secret
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" .env

# 4. Generate random Database Password
echo "Generating random DB_PASSWORD..."
NEW_DB_PASS=$(openssl rand -base64 12)
sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$NEW_DB_PASS/" .env

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
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "Your .env is now configured with secure secrets."
echo -e "Run ${BLUE}pnpm dev${NC} to start the server."
echo -e "------------------------------------------------"