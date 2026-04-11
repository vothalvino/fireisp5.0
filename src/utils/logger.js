// =============================================================================
// FireISP 5.0 — Structured Logger (Pino)
// =============================================================================
// Provides structured JSON logging for development and production.
// Usage:  const logger = require('./utils/logger');
//         logger.info({ clientId: 42 }, 'payment received');
// =============================================================================

const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.log.level,
  ...(config.env !== 'production' && {
    transport: {
      target: 'pino/file',
      options: { destination: 1 },  // stdout
    },
  }),
});

module.exports = logger;
