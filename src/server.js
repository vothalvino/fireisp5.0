// =============================================================================
// FireISP 5.0 — Server Entry Point
// =============================================================================

require('dotenv').config();
const config = require('./config');
const app = require('./app');
const db = require('./config/database');
const scheduler = require('./services/scheduler');

async function start() {
  // Verify database connectivity
  try {
    const [rows] = await db.query('SELECT 1 AS connected');
    if (rows[0].connected === 1) {
      console.log(`  ✓ Database connected (${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '3306'}/${process.env.DB_NAME || 'fireisp'})`);
    }
  } catch (err) {
    console.error('  ✗ Database connection failed:', err.message);
    process.exit(1);
  }

  // Start the cron scheduler
  try {
    await scheduler.start();
  } catch (err) {
    console.error('  ⚠ Scheduler failed to start:', err.message);
  }

  app.listen(config.port, () => {
    console.log(`  ✓ FireISP 5.0 listening on port ${config.port} (${config.env})`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  scheduler.stop();
  await db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  scheduler.stop();
  await db.close();
  process.exit(0);
});

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
