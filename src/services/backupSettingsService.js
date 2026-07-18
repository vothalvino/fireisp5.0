// =============================================================================
// FireISP 5.0 — Remote Backup Settings Service
// =============================================================================
// Thin service layer between src/routes/backupSettings.js and
// src/models/BackupSettings.js / BackupRun.js — the emailSettingsService
// mold, instance-wide instead of per-org.
//
// Config precedence (getEffectiveRemoteConfig): the UI-saved backup_settings
// row wins when remote_enabled and complete; otherwise the BACKUP_S3_* env
// vars (the pre-migration-404 mechanism) remain the fallback; otherwise no
// remote target. A DB read failure falls back to env vars rather than
// erroring — resolving the remote target must never break a backup.
//
// NOTE: src/scripts/backup.js is required LAZILY inside functions here —
// backup.js top-requires this service, so a top-level require back would be
// a cycle.
// =============================================================================

const fs = require('fs');
const path = require('path');
const BackupSettings = require('../models/BackupSettings');
const BackupRun = require('../models/BackupRun');
const cloudStorage = require('./cloudStorageService');
const { ValidationError, ConflictError, NotFoundError } = require('../utils/errors');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger').child({ service: 'backupSettings' });

/**
 * Settings for the UI: masked singleton row plus where the effective remote
 * config would come from right now ('settings' | 'env' | 'none') so the page
 * can tell an admin that env vars are (still) driving uploads.
 */
async function getSettings() {
  const settings = await BackupSettings.get();
  let source = 'none';
  try {
    const effective = await getEffectiveRemoteConfig();
    if (effective) source = effective.source;
  } catch (err) {
    logger.warn({ err }, 'Could not resolve effective remote config');
  }
  return {
    ...settings,
    env_configured: cloudStorage.isConfigured(),
    effective_source: source,
  };
}

/**
 * Validate + save the singleton settings row. Completeness is checked on the
 * MERGED result (payload over existing row — the three-state secret field
 * means the payload alone can't be judged): enabling remote backup with a
 * half-filled destination would otherwise fail silently at 3 AM, the exact
 * bug class the backup-integrity campaign existed to kill.
 * Throws ValidationError (422) with a user-readable message on violation.
 */
async function saveSettings(payload) {
  const fields = payload || {};
  const existing = await BackupSettings.getRaw();

  const merged = {
    remote_enabled: fields.remote_enabled ?? existing?.remote_enabled ?? false,
    provider: fields.provider !== undefined ? fields.provider : (existing?.provider ?? 'custom'),
    bucket: fields.bucket !== undefined ? (fields.bucket || null) : (existing?.bucket ?? null),
    region: fields.region !== undefined ? (fields.region || null) : (existing?.region ?? null),
    endpoint: fields.endpoint !== undefined ? (fields.endpoint || null) : (existing?.endpoint ?? null),
    hasSecret: Object.prototype.hasOwnProperty.call(fields, 'secret_key')
      ? Boolean(fields.secret_key)
      : Boolean(existing?.secret_key_encrypted),
    access_key: fields.access_key !== undefined ? (fields.access_key || null) : (existing?.access_key ?? null),
  };

  if (merged.endpoint) {
    let parsed;
    try {
      parsed = new URL(merged.endpoint);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      throw new ValidationError('Endpoint must be a valid http(s):// URL');
    }
  }

  if (merged.remote_enabled) {
    const missing = [];
    if (!merged.bucket) missing.push('bucket');
    if (!merged.region) missing.push('region');
    if (!merged.access_key) missing.push('access key');
    if (!merged.hasSecret) missing.push('secret key');
    // Only AWS has a derivable endpoint (s3.<region>.amazonaws.com).
    if (merged.provider !== 'aws' && !merged.endpoint) missing.push('endpoint');
    if (missing.length) {
      throw new ValidationError(`Cannot enable remote backup — missing: ${missing.join(', ')}`);
    }
  }

  return BackupSettings.upsert(fields);
}

/**
 * Resolve the remote destination backups should upload to right now, with
 * the secret decrypted — or null when none is configured. NEVER returned
 * from a route handler.
 */
async function getEffectiveRemoteConfig() {
  let raw = null;
  try {
    raw = await BackupSettings.getRaw();
  } catch (err) {
    // Pre-migration DB or transient failure — env vars still work.
    logger.warn({ err }, 'backup_settings unavailable — falling back to BACKUP_S3_* env vars');
  }

  if (raw && raw.remote_enabled) {
    const complete = raw.bucket && raw.region && raw.access_key && raw.secret_key_encrypted &&
      (raw.endpoint || raw.provider === 'aws');
    if (complete) {
      return {
        bucket: raw.bucket,
        region: raw.region,
        accessKey: raw.access_key,
        secretKey: decrypt(raw.secret_key_encrypted),
        endpoint: raw.endpoint || null,
        prefix: raw.prefix ?? 'db-backups/',
        source: 'settings',
      };
    }
    // saveSettings() blocks this state via the API; reachable only by direct
    // DB edits. Loud, and NOT silently replaced by env vars — the admin's
    // intent was the settings row.
    logger.error('backup_settings row is enabled but incomplete — remote upload disabled');
    return null;
  }

  return cloudStorage.resolveEnvConfig();
}

/**
 * Live connection test: upload a tiny probe object to the effective remote
 * destination, then best-effort delete it. Records the outcome on the
 * settings row. Returns {success, error?, source, url?} without throwing on
 * failure — the route returns it inline so the frontend renders the result.
 */
async function testRemote() {
  let config;
  try {
    config = await getEffectiveRemoteConfig();
  } catch (err) {
    return { success: false, source: 'none', error: err.message };
  }
  if (!config) {
    return {
      success: false,
      source: 'none',
      error: 'No remote destination configured — save settings (or set BACKUP_S3_* env vars) first',
    };
  }

  const objectKey = `${cloudStorage.normalizedPrefix(config)}fireisp-connection-test-${Date.now()}.txt`;
  const body = Buffer.from(`FireISP backup connection test ${new Date().toISOString()}\n`, 'utf8');

  try {
    const url = await cloudStorage.uploadObject(config, objectKey, body, 'text/plain');
    try {
      await cloudStorage.deleteObject(config, objectKey);
    } catch (delErr) {
      // Upload proved the destination works; a leftover 60-byte probe object
      // is harmless. Surface it in logs only.
      logger.warn({ err: delErr, objectKey }, 'Probe object delete failed — remove manually if desired');
    }
    await BackupSettings.recordTestResult({ success: true, error: null });
    logger.info({ bucket: config.bucket, source: config.source }, 'Remote backup connection test passed');
    return { success: true, source: config.source, url };
  } catch (err) {
    await BackupSettings.recordTestResult({ success: false, error: err.message });
    logger.warn({ err, bucket: config.bucket, source: config.source }, 'Remote backup connection test failed');
    return { success: false, source: config.source, error: err.message };
  }
}

/**
 * Run history + the local backup files currently on disk.
 */
async function listBackups() {
  const runs = await BackupRun.list(50);

  const { BACKUP_DIR } = require('../scripts/backup'); // lazy — see header
  let files = [];
  try {
    files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql.gz'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, size_bytes: stats.size, modified_at: stats.mtime };
      })
      .sort((a, b) => b.modified_at - a.modified_at);
  } catch (err) {
    // Directory may not exist before the first backup ever runs.
    if (err.code !== 'ENOENT') throw err;
  }

  return { runs, files };
}

/**
 * Resolve a requested backup filename to a safe absolute path inside
 * BACKUP_DIR, for the download endpoint. The filename is client input naming
 * a file that IS the entire database, so validation is an allowlist, not a
 * denylist: only dump-shaped names (letters/digits/._- ending in .sql.gz —
 * no path separators, so no traversal), and the resolved path must still sit
 * directly inside BACKUP_DIR. Throws ValidationError on a malformed name,
 * NotFoundError when no such backup exists.
 */
function resolveBackupFile(name) {
  const { BACKUP_DIR } = require('../scripts/backup'); // lazy — see header
  const filename = String(name || '');

  if (!/^[A-Za-z0-9._-]+\.sql\.gz$/.test(filename)) {
    throw new ValidationError('Invalid backup filename');
  }
  const filepath = path.resolve(BACKUP_DIR, filename);
  if (path.dirname(filepath) !== path.resolve(BACKUP_DIR)) {
    throw new ValidationError('Invalid backup filename');
  }

  let stats;
  try {
    stats = fs.statSync(filepath);
  } catch (err) {
    if (err.code === 'ENOENT') throw new NotFoundError('Backup file');
    throw err;
  }
  if (!stats.isFile()) throw new NotFoundError('Backup file');

  return { filepath, filename, sizeBytes: stats.size };
}

/**
 * The nightly database_backup scheduled task's row (global, org-NULL) —
 * shown on the /backups page so the admin sees when the next automatic
 * backup happens and whether the task is even enabled.
 */
async function getSchedule() {
  const db = require('../config/database');
  const [rows] = await db.query(
    `SELECT cron_expression, is_enabled, last_run_at, last_status, next_run_at
       FROM scheduled_tasks
      WHERE task_name = 'database_backup' AND organization_id IS NULL
      LIMIT 1`,
  );
  return rows[0] || null;
}

/**
 * Kick off a manual backup without awaiting it (a full mysqldump can take
 * minutes). The backup_runs row it writes is how the frontend follows the
 * outcome. Throws ConflictError (409) when one is already running.
 */
async function runBackupNow() {
  const { backup, isRunning } = require('../scripts/backup'); // lazy — see header
  if (isRunning()) {
    throw new ConflictError('A backup is already in progress');
  }
  backup({ trigger: 'manual' }).catch((err) => {
    // Outcome lands in backup_runs; nothing to do here but log.
    logger.error({ err }, 'Manual backup failed');
  });
  return { started: true };
}

module.exports = {
  getSettings,
  saveSettings,
  getEffectiveRemoteConfig,
  testRemote,
  listBackups,
  resolveBackupFile,
  getSchedule,
  runBackupNow,
};
