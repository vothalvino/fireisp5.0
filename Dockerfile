FROM node:18-alpine

RUN addgroup -S fireisp && adduser -S fireisp -G fireisp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production && npm cache clean --force

COPY . .

RUN chown -R fireisp:fireisp /app

USER fireisp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
