# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app

# Enable corepack so the pnpm version declared in package.json is used
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile --filter fireisp-frontend

COPY frontend/ ./frontend/
COPY docs/openapi.json /docs/openapi.json
RUN pnpm --filter fireisp-frontend run build

# ── Stage 2: production API server ────────────────────────────────────────────
FROM node:22-alpine

RUN addgroup -S fireisp && adduser -S fireisp -G fireisp

WORKDIR /app

# Enable corepack for pnpm, install production dependencies only, then remove
# package-manager tooling to keep the runtime image as lean as possible.
RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod \
  && pnpm store prune \
  && corepack disable \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY . .

# Copy the compiled React SPA into the location the Express server expects
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN chown -R fireisp:fireisp /app

USER fireisp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
