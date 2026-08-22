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

# `build` here is gen:api + a whole-program `tsc --noEmit` over 376 files + Vite
# with sourcemaps — measured at ~1.43 GB peak RSS, and by default V8 will keep
# growing until the machine says no. Bounding old-space turns "the host starts
# swapping and stops responding" into "the build fails with a clean JavaScript
# heap OOM", which is a far better failure: it is loud, it is attributable, and
# it leaves the running stack untouched.
#
# CI builds on a 16 GB runner so this never binds there. It matters for anyone
# building locally via docker-compose.build.yml, which is where a small host is
# actually at risk.
ARG FRONTEND_BUILD_HEAP_MB=2048
RUN NODE_OPTIONS="--max-old-space-size=${FRONTEND_BUILD_HEAP_MB}" \
    pnpm --filter fireisp-frontend run build

# ── Stage 2: production API server ────────────────────────────────────────────
FROM node:24-bookworm-slim

# default-mysql-client provides mysqldump/mysql (MariaDB client — dumps and
# restores MySQL 8.x fine, and unlike Oracle's mysqldump needs no GTID
# special-casing against the replicated primary). Without a dump client in the
# image, scheduled database_backup runs produced empty 20-byte "backups".
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends wireguard-tools iproute2 nftables default-mysql-client \
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

# Uploads land in /app/storage, which production mounts as a named Docker volume.
# Docker initialises a named volume from the image's mountpoint, so the directory
# must exist and be owned by the runtime user or the container gets EACCES on write.
RUN mkdir -p /app/storage && chown -R fireisp:fireisp /app/storage

# Server WireGuard keys belong to the isolated helper service. The normal
# web/API process never mounts this directory and always retains USER fireisp.
RUN mkdir -p /etc/wireguard && chmod 700 /etc/wireguard

USER fireisp

# The commit this image was built from. Nothing in the running app knew this
# before: package.json carries a static "5.0.0" that has not moved in the
# platform's lifetime, so "what is actually deployed?" could only be answered by
# SSHing in and reading `git rev-parse HEAD` — which reports the SOURCE tree,
# not the image, and those two disagree precisely when it matters (a rollback
# pins an older image against a newer checkout).
#
# Declared LAST on purpose. GIT_SHA changes on every commit, so every layer at
# or below its first use is cache-busted; putting it here means that is only
# these two lines, not the apt install or the pnpm install above.
#
# Empty when built outside CI (docker-compose.build.yml passes nothing), and the
# app treats an empty value as "unknown" rather than guessing.
ARG GIT_SHA=""
ENV FIREISP_GIT_SHA=$GIT_SHA

EXPOSE 3000
# Embedded RADIUS server (auth + accounting) — only used when RADIUS_SERVER_ENABLED=true
EXPOSE 1812/udp 1813/udp
# WireGuard hub listen ports — inert until the install operator enables the hub
# in Settings. A small isolated helper, not the web/API process, owns NET_ADMIN.
EXPOSE 51820/udp 51821/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
