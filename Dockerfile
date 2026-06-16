# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:24-bookworm-slim AS frontend-build

WORKDIR /app

# Enable corepack so the pnpm version declared in package.json is used
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile --filter fireisp-frontend

COPY frontend/ ./frontend/
COPY docs/openapi.json ./docs/openapi.json
RUN pnpm --filter fireisp-frontend run build

# ── Stage 2: production API server ────────────────────────────────────────────
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system fireisp && useradd --system --gid fireisp --no-create-home fireisp

WORKDIR /app

# Enable corepack for pnpm, install production dependencies only, then remove
# package-manager tooling to keep the runtime image as lean as possible.
RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod \
  && pnpm store prune \
  && rm -rf /root/.cache/node/corepack \
  && corepack disable \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY . .

# Copy the compiled React SPA into the location the Express server expects
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN chown -R fireisp:fireisp /app

USER fireisp

EXPOSE 3000
# Embedded RADIUS server (auth + accounting) — only used when RADIUS_SERVER_ENABLED=true
EXPOSE 1812/udp 1813/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
