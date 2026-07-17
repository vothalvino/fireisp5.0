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
// Requires: mysqldump binary in PATH (the production image installs
// default-mysql-client; see Dockerfile).
//
// Failure honesty: the dump runs as a direct spawn (no shell pipeline) with
// gzip done in-process, because the previous `execSync('mysqldump … | gzip >
// file')` form reported the PIPELINE's exit status (gzip's), so a missing
// binary or failed dump produced a 20-byte empty-gzip file that was logged as
// "Backup created" — silently broken backups on every Docker install until
// the quarterly DR drill's size check caught it.
// =============================================================================

require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const logger = require('../utils/logger').child({ script: 'backup' });
const cloudStorage = require('../services/cloudStorageService');

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(__dirname, '../../storage/backups');
const MAX_BACKUPS = parseInt(process.env.BACKUP_RETENTION || '7', 10);
// An empty gzip stream is 20 bytes — anything near that means the dump wrote
// nothing. Even a schema-only dump of one table gzips past this floor.
const MIN_BACKUP_BYTES = parseInt(process.env.BACKUP_MIN_BYTES || '512', 10);

/**
 * Run mysqldump → gzip → filepath without a shell: the exit code checked is
 * mysqldump's own (a pipeline reports only the last command's), stderr is
 * captured for the error message, and the password travels via MYSQL_PWD so
 * it never appears in `ps` output or logged command lines.
 */
function runDump({ host, port, user, password, database, filepath }) {
  const args = [
    `--host=${host}`,
    `--port=${port}`,
    `--user=${user}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    '--events',
    // Without this, mysqldump 8+ needs the global PROCESS privilege to dump
    // tablespace info — which the app's DB user correctly does not have.
    '--no-tablespaces',
    database,
  ];
  const env = password ? { ...process.env, MYSQL_PWD: password } : { ...process.env };

  return new Promise((resolve, reject) => {
    const child = spawn('mysqldump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let settled = false;
    child.stderr.on('data', (d) => { stderr += d; });

    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(filepath);
    const written = pipeline(child.stdout, gzip, out);
    // Swallow the direct rejection path — every consumer below re-awaits
    // `written`, so a premature-close after a spawn error can't warn as
    // unhandled.
    written.catch(() => {});

    // Reject only after the write side has settled: the caller unlinks the
    // partial file on failure, so the stream must be done touching it first.
    const fail = (err) => {
      if (settled) return;
      settled = true;
      written.then(() => reject(err), () => reject(err));
    };
    // Spawn failure (e.g. ENOENT: binary not installed) → fail; 'close' is not
    // guaranteed after a failed spawn.
    child.on('error', fail);

    // 'close' delivers mysqldump's REAL exit code — the whole point vs. the
    // old shell pipeline, whose status was gzip's. Wait for the file flush
    // (`written`) before resolving so the size check sees the final bytes.
    child.on('close', (code) => {
      written
        .then(() => {
          if (settled) return;
          settled = true;
          if (code !== 0) {
            reject(new Error(`mysqldump exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
          } else {
            if (stderr.trim()) logger.warn({ stderr: stderr.trim().slice(0, 500) }, 'mysqldump warnings');
            resolve();
          }
        })
        .catch(fail);
    });
  });
}

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

  try {
    await runDump({ host, port, user, password, database, filepath });

    // Belt-and-braces: a "successful" dump that wrote (nearly) nothing is a
    // failure, never a backup.
    const stats = fs.statSync(filepath);
    if (stats.size < MIN_BACKUP_BYTES) {
      throw new Error(`Backup file is suspiciously small (${stats.size} bytes < ${MIN_BACKUP_BYTES}) — treating as failed`);
    }
    logger.info({ filename, sizeKB: (stats.size / 1024).toFixed(1) }, 'Backup created');
  } catch (err) {
    // Clean up partial/empty file so a broken run never masquerades as a backup
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    if (err.code === 'ENOENT') {
      const msg = 'mysqldump not found in PATH — install the MySQL client tools (the production image ships default-mysql-client)';
      logger.error({ err }, msg);
      throw new Error(msg, { cause: err });
    }
    logger.error({ err }, 'Backup failed');
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
