// =============================================================================
// FireISP 5.0 — Server Entry Point
// =============================================================================

require('dotenv').config();
const config = require('./config');
const app = require('./app');
const db = require('./config/database');
const scheduler = require('./services/scheduler');
const jobQueue = require('./services/jobQueueService');
const workers = require('./workers');
const { tunnelServer } = require('./services/firerelayTunnel');
const { wsHub } = require('./services/wsHub');
const snmpTrapReceiver = require('./services/snmpTrapReceiver');
const radiusServer = require('./services/radiusServerService');
const wireguardServerService = require('./services/wireguardServerService');
const wgProvisioningService = require('./services/wgProvisioningService');
const userTunnelService = require('./services/userTunnelService');
const logger = require('./utils/logger');

async function start() {
  // Validate critical environment variables before anything else
  config.validateEnv(logger);

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
  } catch (migrationErr) {
    // schema_migrations table may not exist yet on fresh installs
    logger.warn({ err: migrationErr }, 'Could not check migration status — run `npm run migrate` first');
  }

  // Start the cron scheduler
  try {
    await scheduler.start();
  } catch (err) {
    logger.warn({ err }, 'Scheduler failed to start');
  }

  // Register BullMQ job workers (no-op when REDIS_URL is unset)
  try {
    workers.registerWorkers();
  } catch (err) {
    logger.warn({ err }, 'Worker registration failed');
  }

  // Bring up the WireGuard host interfaces (no-op unless WG_SERVER_ENABLED=true).
  // Done before app.listen so config.wireguard.{server,client}PublicKey are
  // populated before any request issues a NAS/user config. Best-effort: a host
  // without CAP_NET_ADMIN logs a warning and the API still starts (config-only).
  try {
    await wireguardServerService.bootstrapHost();
  } catch (err) {
    logger.warn({ err }, 'WireGuard host bootstrap failed');
  }

  // Re-add every NAS + user WireGuard peer to the hub from the database. Kernel
  // peers and per-user nftables scope live only in the interface's runtime
  // state, which a container restart wipes — bootstrapHost recreates the
  // interfaces but not the peers, so without this every tunnel would stay down
  // after a restart until manually re-saved. Idempotent + best-effort; each
  // call no-ops unless WG_SERVER_ENABLED=true.
  // Independent try/catch each: a failure restoring NAS peers must not suppress
  // user-peer restoration (and vice versa).
  try {
    await wgProvisioningService.rehydrateNasPeers();
  } catch (err) {
    logger.warn({ err }, 'WireGuard NAS peer rehydration failed');
  }
  try {
    await userTunnelService.rehydrateUserPeers();
  } catch (err) {
    logger.warn({ err }, 'WireGuard user peer rehydration failed');
  }

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'FireISP 5.0 listening');
  });

  // Attach the FireRelay WebSocket tunnel to the HTTP server
  try {
    tunnelServer.attach(server);
  } catch (err) {
    logger.warn({ err }, 'FireRelay tunnel failed to attach');
  }

  // Attach the WebSocket hub for real-time browser clients
  try {
    wsHub.attach(server);
  } catch (err) {
    logger.warn({ err }, 'WsHub failed to attach');
  }

  // Start the SNMP trap receiver (UDP listener for unsolicited device alerts)
  try {
    snmpTrapReceiver.start();
  } catch (err) {
    logger.warn({ err }, 'SNMP trap receiver failed to start');
  }

  // Start the embedded RADIUS server (no-op unless RADIUS_SERVER_ENABLED=true)
  try {
    radiusServer.start();
  } catch (err) {
    logger.warn({ err }, 'Embedded RADIUS server failed to start');
  }

  // ---------------------------------------------------------------------------
  // Graceful shutdown — drain HTTP connections before exiting
  // ---------------------------------------------------------------------------
  const SHUTDOWN_TIMEOUT_MS = 15000;

  function gracefulShutdown(signal) {
    logger.info({ signal }, `${signal} received, starting graceful shutdown…`);

    // Stop accepting new connections; let in-flight requests finish
    server.close(async () => {
      logger.info('HTTP server closed');
      await tunnelServer.close();
      await wsHub.close().catch(() => {});
      snmpTrapReceiver.stop();
      radiusServer.stop();
      scheduler.stop();
      await jobQueue.close().catch(() => {});
      await db.close();
      logger.info('All resources released — exiting');
      process.exit(0);
    });

    // Safety net: force-exit if draining takes too long
    setTimeout(() => {
      logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown timeout reached — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

start().catch(err => {
  logger.fatal({ errorName: err?.name || 'Error' }, 'Failed to start');
  process.exit(1);
});
