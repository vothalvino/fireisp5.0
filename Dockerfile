# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

COPY frontend/ ./
COPY docs/openapi.json /docs/openapi.json
RUN npm run build

# ── Stage 2: production API server ────────────────────────────────────────────
FROM node:22-alpine

RUN addgroup -S fireisp && adduser -S fireisp -G fireisp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production && npm cache clean --force

COPY . .

# Copy the compiled React SPA into the location the Express server expects
COPY --from=frontend-build /frontend/dist ./frontend/dist

RUN chown -R fireisp:fireisp /app

USER fireisp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
