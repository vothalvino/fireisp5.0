// =============================================================================
// FireISP 5.0 — Database Backup Script
// =============================================================================
// Creates a gzipped mysqldump backup in storage/backups/ with rotation.
// Keeps the last N backups (default 7) and removes older ones.
//
// When cloud storage is configured (BACKUP_S3_BUCKET + credentials), the
// backup is also uploaded to S3 or a Backblaze B2 S3-compatible bucket.
//
// Usage:  node src/scripts/backup.js
//         npm run backup
//
// Requires: mysqldump binary available in PATH (standard MySQL client tools).
// =============================================================================

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').child({ script: 'backup' });
const cloudStorage = require('../services/cloudStorageService');

const BACKUP_DIR = path.resolve(__dirname, '../../storage/backups');
const MAX_BACKUPS = parseInt(process.env.BACKUP_RETENTION || '7', 10);

async function backup() {
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = process.env.DB_PORT || '3306';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'fireisp';

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${database}_${timestamp}.sql.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  logger.info({ filename }, 'Creating backup');

  // Build mysqldump command — pipe through gzip for compression
  const dumpCmd = [
    'mysqldump',
    `--host=${host}`,
    `--port=${port}`,
    `--user=${user}`,
    password ? `--password=${password}` : '',
    '--single-transaction',
    '--routines',
    '--triggers',
    '--events',
    database,
    `| gzip > ${filepath}`,
  ].filter(Boolean).join(' ');

  try {
    execSync(dumpCmd, { stdio: 'pipe', shell: true });
    const stats = fs.statSync(filepath);
    logger.info({ filename, sizeKB: (stats.size / 1024).toFixed(1) }, 'Backup created');
  } catch (err) {
    logger.error({ err }, 'Backup failed');
    // Clean up partial file
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    throw err;
  }

  // Upload to cloud storage (S3/B2) if configured
  let cloudUrl = null;
  if (cloudStorage.isConfigured()) {
    try {
      cloudUrl = await cloudStorage.uploadBackup(filepath, filename);
      logger.info({ filename, cloudUrl }, 'Backup uploaded to cloud storage');
    } catch (uploadErr) {
      // Cloud upload failure is logged but does not fail the backup — the local
      // copy is already safe. An operator can manually re-upload if needed.
      logger.error({ err: uploadErr, filename }, 'Cloud upload failed — local backup retained');
    }
  } else {
    logger.warn('Cloud storage not configured — backup saved locally only');
  }

  // Rotate old backups
  rotate();

  return { filepath, cloudUrl };
}

/**
 * Remove oldest backups if count exceeds MAX_BACKUPS.
 */
function rotate() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.sql.gz'))
    .sort();

  if (files.length > MAX_BACKUPS) {
    const toRemove = files.slice(0, files.length - MAX_BACKUPS);
    for (const file of toRemove) {
      const fp = path.join(BACKUP_DIR, file);
      fs.unlinkSync(fp);
      logger.info({ file }, 'Rotated backup');
    }
  }
}

// Run when invoked directly
if (require.main === module) {
  logger.info('FireISP 5.0 — Creating database backup...');
  backup().then(() => {
    logger.info('Done.');
    process.exit(0);
  }).catch((_err) => {
    process.exit(1);
  });
}

module.exports = { backup, rotate };
