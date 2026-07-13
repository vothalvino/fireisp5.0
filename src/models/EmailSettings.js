// =============================================================================
// FireISP 5.0 — Per-Organization Outbound Email (SMTP) Settings Model
// =============================================================================
// Mirrors src/models/OrganizationDatabaseConfig.js exactly: one row per org,
// an AES-256-GCM encrypted secret column, and a toPublic() that returns a
// masked boolean (`configured`) instead of the ciphertext. The encrypted
// column is NEVER included in any response — see toPublic() below.
// =============================================================================

const BaseModel = require('./BaseModel');
const { encrypt } = require('../utils/encryption');

class EmailSettings extends BaseModel {
  static get tableName() { return 'organization_email_settings'; }

  static get fillable() {
    return [
      'organization_id', 'enabled', 'smtp_host', 'smtp_port', 'smtp_secure',
      'smtp_user', 'smtp_password_encrypted', 'from_email', 'from_name',
    ];
  }

  static get hasOrgScope() { return false; }

  static defaultForOrg(orgId) {
    return {
      organization_id: Number(orgId),
      enabled: false,
      smtp_host: null,
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: null,
      from_email: null,
      from_name: null,
      configured: false,
      last_test_at: null,
      last_test_status: null,
      last_test_error: null,
    };
  }

  static toPublic(row) {
    if (!row) return null;
    return {
      organization_id: row.organization_id,
      enabled: Boolean(row.enabled),
      smtp_host: row.smtp_host || null,
      smtp_port: row.smtp_port || 587,
      smtp_secure: Boolean(row.smtp_secure),
      smtp_user: row.smtp_user || null,
      from_email: row.from_email || null,
      from_name: row.from_name || null,
      // smtp_password_encrypted is intentionally NEVER included here.
      configured: Boolean(row.smtp_password_encrypted),
      last_test_at: row.last_test_at || null,
      last_test_status: row.last_test_status || null,
      last_test_error: row.last_test_error || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  static async findByOrgId(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM organization_email_settings WHERE organization_id = ?',
      [orgId],
    );
    return this.toPublic(rows[0]) || this.defaultForOrg(orgId);
  }

  /**
   * Raw row (including ciphertext) — internal use only. Consumed by
   * emailTransport.getOrgTransport() at send/test time; never returned from
   * a route handler.
   */
  static async findRawByOrgId(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM organization_email_settings WHERE organization_id = ?',
      [orgId],
    );
    return rows[0] || null;
  }

  /**
   * Upsert settings for an org. Password three-state contract (mirrors
   * ai.js:229-231 / OrganizationDatabaseConfig.upsert):
   *   fields.smtp_password === undefined  -> keep existing encrypted value
   *   fields.smtp_password === ''         -> clear to NULL
   *   fields.smtp_password === 'value'    -> encrypt and replace
   */
  static async upsert(orgId, fields) {
    const db = require('../config/database');
    const existing = await this.findRawByOrgId(orgId);

    const row = {
      enabled: fields.enabled ?? existing?.enabled ?? true,
      smtp_host: fields.smtp_host !== undefined ? (fields.smtp_host || null) : (existing?.smtp_host ?? null),
      smtp_port: fields.smtp_port !== undefined ? Number(fields.smtp_port) : (existing?.smtp_port ?? 587),
      smtp_secure: fields.smtp_secure ?? existing?.smtp_secure ?? false,
      smtp_user: fields.smtp_user !== undefined ? (fields.smtp_user || null) : (existing?.smtp_user ?? null),
      smtp_password_encrypted: Object.prototype.hasOwnProperty.call(fields, 'smtp_password')
        ? (fields.smtp_password ? encrypt(fields.smtp_password) : null)
        : existing?.smtp_password_encrypted ?? null,
      from_email: fields.from_email !== undefined ? (fields.from_email || null) : (existing?.from_email ?? null),
      from_name: fields.from_name !== undefined ? (fields.from_name || null) : (existing?.from_name ?? null),
    };

    await db.query(
      `INSERT INTO organization_email_settings
         (organization_id, enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_encrypted, from_email, from_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         smtp_host = VALUES(smtp_host),
         smtp_port = VALUES(smtp_port),
         smtp_secure = VALUES(smtp_secure),
         smtp_user = VALUES(smtp_user),
         smtp_password_encrypted = VALUES(smtp_password_encrypted),
         from_email = VALUES(from_email),
         from_name = VALUES(from_name)`,
      [
        orgId,
        row.enabled ? 1 : 0,
        row.smtp_host,
        row.smtp_port,
        row.smtp_secure ? 1 : 0,
        row.smtp_user,
        row.smtp_password_encrypted,
        row.from_email,
        row.from_name,
      ],
    );

    // Take effect on the very next send, not after a TTL — lazy require to
    // avoid a require cycle (emailTransport requires this model to read the
    // raw row at send time).
    const emailTransport = require('../services/emailTransport');
    if (typeof emailTransport.invalidateOrgTransport === 'function') {
      emailTransport.invalidateOrgTransport(orgId);
    }

    return this.findByOrgId(orgId);
  }

  static async recordTestResult(orgId, { success, error }) {
    const db = require('../config/database');
    await db.query(
      `UPDATE organization_email_settings
         SET last_test_at = NOW(), last_test_status = ?, last_test_error = ?
       WHERE organization_id = ?`,
      [success ? 'success' : 'failed', success ? null : (error || 'Unknown error'), orgId],
    );
  }
}

module.exports = EmailSettings;
