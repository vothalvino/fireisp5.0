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

  // Check migration status
  try {
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.resolve(__dirname, '../database/migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    const [applied] = await db.query(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    );
    const appliedCount = applied[0].count;
    const totalCount = migrationFiles.length;

    if (appliedCount < totalCount) {
      logger.warn(
        { applied: appliedCount, total: totalCount, pending: totalCount - appliedCount },
        'Pending migrations detected — run `npm run migrate`',
      );
    } else {
      logger.info({ migrations: appliedCount }, 'All migrations applied');
    }
  } catch (_err) {
    // schema_migrations table may not exist yet on fresh installs
    logger.warn('Could not check migration status — run `npm run migrate` first');
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
