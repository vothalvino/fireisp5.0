// =============================================================================
// FireISP 5.0 — Server Entry Point
// =============================================================================

require('dotenv').config();
const config = require('./config');
const app = require('./app');
const db = require('./config/database');
const scheduler = require('./services/scheduler');
const logger = require('./utils/logger');

async function start() {
  // Verify database connectivity
  try {
    const [rows] = await db.query('SELECT 1 AS connected');
    if (rows[0].connected === 1) {
      logger.info({ host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || '3306', db: process.env.DB_NAME || 'fireisp' }, 'Database connected');
    }
  } catch (err) {
    logger.fatal({ err }, 'Database connection failed');
    process.exit(1);
  }

  // Start the cron scheduler
  try {
    await scheduler.start();
  } catch (err) {
    logger.warn({ err }, 'Scheduler failed to start');
  }

  app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'FireISP 5.0 listening');
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  scheduler.stop();
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  scheduler.stop();
  await db.close();
  process.exit(0);
});

start().catch(err => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
