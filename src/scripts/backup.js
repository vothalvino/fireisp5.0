// =============================================================================
// FireISP 5.0 — Database Backup Script
// =============================================================================
// Creates a gzipped mysqldump backup in storage/backups/ with rotation.
// Keeps the last N backups (default 7) and removes older ones.
//
// When a remote destination is configured — UI-saved backup_settings row
// (migration 404) first, BACKUP_S3_* env vars as fallback — the backup is
// also uploaded to the S3-compatible bucket (AWS S3, GCS interop, B2, R2,
// or self-hosted MinIO).
//
// Every execution records a row in backup_runs (scheduled / manual / drill)
// so silent failure — of the dump OR of the remote upload — is visible on
// the /backups admin page, not just in server logs. Run recording is
// best-effort: a failure to write the row never blocks the backup itself,
// and all DB-touching modules are required lazily inside backup() so plain
// `require`s of this script (rotate-only callers, tests) stay DB-free.
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

// In-process concurrency guard: the nightly task, the DR drill, and the
// manual Run-now button all funnel through backup(); two dumps at once only
// waste disk and I/O. (Best-effort — separate processes each have their own
// flag; the backup_runs 'running' row is the cross-process signal.)
let running = false;

function isRunning() {
  return running;
}

async function backup({ trigger = 'scheduled' } = {}) {
  if (running) {
    throw new Error('A backup is already in progress');
  }
  running = true;
  try {
    return await doBackup(trigger);
  } finally {
    running = false;
  }
}

async function doBackup(trigger) {
  // Lazy DB-touching requires — see header comment.
  const BackupRun = require('../models/BackupRun');
  const backupSettingsService = require('../services/backupSettingsService');

  let runId = null;
  try {
    runId = await BackupRun.start(trigger);
  } catch (err) {
    logger.warn({ err }, 'backup_runs recording unavailable — continuing without run history');
  }
  const finishRun = async (fields) => {
    if (runId === null) return;
    try {
      await BackupRun.finish(runId, fields);
    } catch (err) {
      logger.warn({ err, runId }, 'Could not finalize backup_runs row');
    }
  };

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
      await finishRun({ status: 'failed', errorMessage: msg });
      throw new Error(msg, { cause: err });
    }
    logger.error({ err }, 'Backup failed');
    await finishRun({ status: 'failed', errorMessage: err.message });
    throw err;
  }

  const sizeBytes = fs.statSync(filepath).size;

  // Upload to the remote destination when one is configured: UI-saved
  // backup_settings first, BACKUP_S3_* env vars as fallback.
  let remoteConfig;
  try {
    remoteConfig = await backupSettingsService.getEffectiveRemoteConfig();
  } catch (err) {
    // Belt-and-braces (the service already falls back internally): a broken
    // settings read must never turn a good dump into a failed backup.
    logger.warn({ err }, 'Could not resolve remote backup settings — trying env vars');
    remoteConfig = cloudStorage.resolveEnvConfig();
  }

  let cloudUrl = null;
  let remoteStatus = 'disabled';
  let remoteError = null;
  if (remoteConfig) {
    try {
      cloudUrl = await cloudStorage.uploadBackup(filepath, filename, remoteConfig);
      remoteStatus = 'uploaded';
      logger.info({ filename, cloudUrl, source: remoteConfig.source }, 'Backup uploaded to remote storage');
    } catch (uploadErr) {
      // Remote upload failure is logged but does not fail the backup — the
      // local copy is already safe. It IS surfaced: remote_status='failed'
      // lands in backup_runs and on the /backups page.
      remoteStatus = 'failed';
      remoteError = uploadErr.message;
      logger.error({ err: uploadErr, filename }, 'Remote upload failed — local backup retained');
    }
  } else {
    logger.warn('Remote backup not configured — backup saved locally only');
  }

  await finishRun({
    status: 'success',
    filename,
    sizeBytes,
    remoteStatus,
    remoteUrl: cloudUrl,
    errorMessage: remoteError,
  });

  // Rotate old backups
  rotate();

  return { filepath, cloudUrl, remoteStatus };
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

module.exports = { backup, rotate, isRunning, BACKUP_DIR };
