// =============================================================================
// FireISP 5.0 — Remote Backup Settings Model (singleton)
// =============================================================================
// Mirrors src/models/EmailSettings.js exactly, except the row is a SINGLETON
// (id = 1) — database backups are instance-wide, like the org-NULL
// `database_backup` scheduled task. The AES-256-GCM encrypted secret column
// is NEVER included in any response — see toPublic() below.
// =============================================================================

const BaseModel = require('./BaseModel');
const { encrypt } = require('../utils/encryption');

const SINGLETON_ID = 1;

class BackupSettings extends BaseModel {
  static get tableName() { return 'backup_settings'; }

  static get fillable() {
    return [
      'remote_enabled', 'provider', 'bucket', 'region', 'endpoint',
      'prefix', 'access_key', 'secret_key_encrypted',
    ];
  }

  static get hasOrgScope() { return false; }

  static defaults() {
    return {
      remote_enabled: false,
      provider: 'custom',
      bucket: null,
      region: null,
      endpoint: null,
      prefix: 'db-backups/',
      access_key: null,
      secret_configured: false,
      last_test_at: null,
      last_test_status: null,
      last_test_error: null,
    };
  }

  static toPublic(row) {
    if (!row) return null;
    return {
      remote_enabled: Boolean(row.remote_enabled),
      provider: row.provider || 'custom',
      bucket: row.bucket || null,
      region: row.region || null,
      endpoint: row.endpoint || null,
      prefix: row.prefix ?? 'db-backups/',
      access_key: row.access_key || null,
      // secret_key_encrypted is intentionally NEVER included here.
      secret_configured: Boolean(row.secret_key_encrypted),
      last_test_at: row.last_test_at || null,
      last_test_status: row.last_test_status || null,
      last_test_error: row.last_test_error || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  static async get() {
    const raw = await this.getRaw();
    return this.toPublic(raw) || this.defaults();
  }

  /**
   * Raw row (including ciphertext) — internal use only. Consumed by
   * backupSettingsService.getEffectiveRemoteConfig() at backup/test time;
   * never returned from a route handler.
   */
  static async getRaw() {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM backup_settings WHERE id = ?',
      [SINGLETON_ID],
    );
    return rows[0] || null;
  }

  /**
   * Upsert the singleton row. Secret three-state contract (mirrors
   * EmailSettings.upsert):
   *   fields.secret_key === undefined  -> keep existing encrypted value
   *   fields.secret_key === ''         -> clear to NULL
   *   fields.secret_key === 'value'    -> encrypt and replace
   */
  static async upsert(fields) {
    const db = require('../config/database');
    const existing = await this.getRaw();

    const row = {
      remote_enabled: fields.remote_enabled ?? existing?.remote_enabled ?? false,
      provider: fields.provider !== undefined ? fields.provider : (existing?.provider ?? 'custom'),
      bucket: fields.bucket !== undefined ? (fields.bucket || null) : (existing?.bucket ?? null),
      region: fields.region !== undefined ? (fields.region || null) : (existing?.region ?? null),
      endpoint: fields.endpoint !== undefined ? (fields.endpoint || null) : (existing?.endpoint ?? null),
      prefix: fields.prefix !== undefined ? (fields.prefix ?? 'db-backups/') : (existing?.prefix ?? 'db-backups/'),
      access_key: fields.access_key !== undefined ? (fields.access_key || null) : (existing?.access_key ?? null),
      secret_key_encrypted: Object.prototype.hasOwnProperty.call(fields, 'secret_key')
        ? (fields.secret_key ? encrypt(fields.secret_key) : null)
        : existing?.secret_key_encrypted ?? null,
    };

    await db.query(
      `INSERT INTO backup_settings
         (id, remote_enabled, provider, bucket, region, endpoint, prefix, access_key, secret_key_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         remote_enabled = VALUES(remote_enabled),
         provider = VALUES(provider),
         bucket = VALUES(bucket),
         region = VALUES(region),
         endpoint = VALUES(endpoint),
         prefix = VALUES(prefix),
         access_key = VALUES(access_key),
         secret_key_encrypted = VALUES(secret_key_encrypted)`,
      [
        SINGLETON_ID,
        row.remote_enabled ? 1 : 0,
        row.provider,
        row.bucket,
        row.region,
        row.endpoint,
        row.prefix,
        row.access_key,
        row.secret_key_encrypted,
      ],
    );

    return this.get();
  }

  /**
   * Record a connection-test outcome. INSERT..ON DUPLICATE so the result is
   * kept even when no settings row exists yet (env-var-configured installs
   * testing from the UI before ever saving).
   */
  static async recordTestResult({ success, error }) {
    const db = require('../config/database');
    await db.query(
      `INSERT INTO backup_settings (id, last_test_at, last_test_status, last_test_error)
       VALUES (?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         last_test_at = VALUES(last_test_at),
         last_test_status = VALUES(last_test_status),
         last_test_error = VALUES(last_test_error)`,
      [SINGLETON_ID, success ? 'success' : 'failed', success ? null : (error || 'Unknown error')],
    );
  }
}

module.exports = BackupSettings;
