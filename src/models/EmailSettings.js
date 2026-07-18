// =============================================================================
// FireISP 5.0 — Per-Organization, Per-Function Outbound Email (SMTP) Settings
// =============================================================================
// One row per (organization_id, email_function) since migration 407: an org
// can hold a separate outbound identity for 'general', 'support', 'billing',
// and 'noc'. The encrypted secret column is NEVER included in any response —
// see toPublic(). At send time an unconfigured function falls back to the
// org's 'general' identity, then the global SMTP env config
// (see emailTransport.getOrgTransport).
// =============================================================================

const BaseModel = require('./BaseModel');
const { encrypt } = require('../utils/encryption');

const FUNCTIONS = ['general', 'support', 'billing', 'noc'];
const DEFAULT_FUNCTION = 'general';

function normalizeFunction(fn) {
  return FUNCTIONS.includes(fn) ? fn : DEFAULT_FUNCTION;
}

class EmailSettings extends BaseModel {
  static get tableName() { return 'organization_email_settings'; }

  static get FUNCTIONS() { return FUNCTIONS; }
  static get DEFAULT_FUNCTION() { return DEFAULT_FUNCTION; }

  static get fillable() {
    return [
      'organization_id', 'email_function', 'enabled', 'smtp_host', 'smtp_port',
      'smtp_secure', 'smtp_user', 'smtp_password_encrypted', 'from_email', 'from_name',
    ];
  }

  static get hasOrgScope() { return false; }

  static defaultForOrg(orgId, emailFunction = DEFAULT_FUNCTION) {
    return {
      organization_id: Number(orgId),
      email_function: normalizeFunction(emailFunction),
      enabled: false,
      smtp_host: null,
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: null,
      from_email: null,
      from_name: null,
      configured: false,
      has_password: false,
      last_test_at: null,
      last_test_status: null,
      last_test_error: null,
    };
  }

  static toPublic(row) {
    if (!row) return null;
    return {
      organization_id: row.organization_id,
      email_function: row.email_function || DEFAULT_FUNCTION,
      enabled: Boolean(row.enabled),
      smtp_host: row.smtp_host || null,
      smtp_port: row.smtp_port || 587,
      smtp_secure: Boolean(row.smtp_secure),
      smtp_user: row.smtp_user || null,
      from_email: row.from_email || null,
      from_name: row.from_name || null,
      // smtp_password_encrypted is intentionally NEVER included here.
      // `configured` = has a usable server (drives the status badge);
      // `has_password` = a secret is stored (drives the write-only password
      // placeholder). Split so a host-only row doesn't claim a saved password.
      configured: Boolean(row.smtp_host),
      has_password: Boolean(row.smtp_password_encrypted),
      last_test_at: row.last_test_at || null,
      last_test_status: row.last_test_status || null,
      last_test_error: row.last_test_error || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /** Public settings for one function (falls back to a safe default shape). */
  static async findByOrgId(orgId, emailFunction = DEFAULT_FUNCTION) {
    const fn = normalizeFunction(emailFunction);
    const raw = await this.findRawByOrgId(orgId, fn);
    return this.toPublic(raw) || this.defaultForOrg(orgId, fn);
  }

  /** Public settings for EVERY function — one entry per FUNCTIONS member. */
  static async listByOrgId(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM organization_email_settings WHERE organization_id = ?',
      [orgId],
    );
    const byFunction = {};
    for (const row of rows) byFunction[row.email_function] = row;
    return FUNCTIONS.map(fn => this.toPublic(byFunction[fn]) || this.defaultForOrg(orgId, fn));
  }

  /**
   * Raw row (including ciphertext) for one function — internal use only.
   * Consumed by emailTransport.getOrgTransport() at send/test time; never
   * returned from a route handler.
   */
  static async findRawByOrgId(orgId, emailFunction = DEFAULT_FUNCTION) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM organization_email_settings WHERE organization_id = ? AND email_function = ?',
      [orgId, normalizeFunction(emailFunction)],
    );
    return rows[0] || null;
  }

  /**
   * Upsert settings for one (org, function). Password three-state contract
   * (mirrors ai.js:229-231 / OrganizationDatabaseConfig.upsert):
   *   fields.smtp_password === undefined  -> keep existing encrypted value
   *   fields.smtp_password === ''         -> clear to NULL
   *   fields.smtp_password === 'value'    -> encrypt and replace
   */
  static async upsert(orgId, emailFunction, fields) {
    const db = require('../config/database');
    const fn = normalizeFunction(emailFunction);
    const existing = await this.findRawByOrgId(orgId, fn);

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
         (organization_id, email_function, enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_encrypted, from_email, from_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        fn,
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

    return this.findByOrgId(orgId, fn);
  }

  static async recordTestResult(orgId, emailFunction, { success, error }) {
    const db = require('../config/database');
    const fn = normalizeFunction(emailFunction);
    // INSERT..ON DUPLICATE so the result is kept even when the function has no
    // row yet (an admin testing general/global before saving anything).
    // enabled=0 explicitly: a row created purely by a test must NOT inherit
    // the column's DEFAULT 1, or an untouched function would report as an
    // active identity. On an existing row `enabled` is left as-is.
    await db.query(
      `INSERT INTO organization_email_settings (organization_id, email_function, enabled, last_test_at, last_test_status, last_test_error)
       VALUES (?, ?, 0, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         last_test_at = NOW(), last_test_status = VALUES(last_test_status), last_test_error = VALUES(last_test_error)`,
      [orgId, fn, success ? 'success' : 'failed', success ? null : (error || 'Unknown error')],
    );
  }
}

module.exports = EmailSettings;
