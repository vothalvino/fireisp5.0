// =============================================================================
// FireISP 5.0 — Organization Database Isolation Config Model
// =============================================================================

const BaseModel = require('./BaseModel');
const { encrypt, decrypt } = require('../utils/encryption');

const CONNECTION_FIELDS = ['db_host', 'db_port', 'db_name', 'db_user', 'ssl_enabled'];

class OrganizationDatabaseConfig extends BaseModel {
  static get tableName() { return 'organization_database_configs'; }

  static get fillable() {
    return [
      'organization_id', 'isolation_mode', 'db_host', 'db_port', 'db_name',
      'db_user', 'db_password_encrypted', 'ssl_enabled',
    ];
  }

  static get hasOrgScope() { return false; }

  static defaultForOrg(orgId) {
    return {
      organization_id: Number(orgId),
      isolation_mode: 'shared',
      db_host: null,
      db_port: 3306,
      db_name: null,
      db_user: null,
      ssl_enabled: false,
      has_password: false,
    };
  }

  static toPublic(row) {
    if (!row) return null;
    return {
      organization_id: row.organization_id,
      isolation_mode: row.isolation_mode || 'shared',
      db_host: row.db_host || null,
      db_port: row.db_port || 3306,
      db_name: row.db_name || null,
      db_user: row.db_user || null,
      ssl_enabled: Boolean(row.ssl_enabled),
      has_password: Boolean(row.db_password_encrypted),
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_verified_at: row.last_verified_at,
    };
  }

  static toConnectionConfig(row) {
    if (!row || row.isolation_mode !== 'isolated') return null;
    return {
      host: row.db_host,
      port: row.db_port || 3306,
      database: row.db_name,
      user: row.db_user,
      password: decrypt(row.db_password_encrypted) || '',
      ssl: row.ssl_enabled ? {} : undefined,
    };
  }

  static async findByOrgId(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM organization_database_configs WHERE organization_id = ?',
      [orgId],
    );
    return this.toPublic(rows[0]) || this.defaultForOrg(orgId);
  }

  static async findRawByOrgId(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM organization_database_configs WHERE organization_id = ?',
      [orgId],
    );
    return rows[0] || null;
  }

  static async upsert(orgId, fields) {
    const db = require('../config/database');
    const existing = await this.findRawByOrgId(orgId);
    const mode = fields.isolation_mode || existing?.isolation_mode || 'shared';

    const row = {
      isolation_mode: mode,
      db_host: mode === 'shared' ? null : fields.db_host ?? existing?.db_host ?? null,
      db_port: mode === 'shared' ? 3306 : Number(fields.db_port ?? existing?.db_port ?? 3306),
      db_name: mode === 'shared' ? null : fields.db_name ?? existing?.db_name ?? null,
      db_user: mode === 'shared' ? null : fields.db_user ?? existing?.db_user ?? null,
      db_password_encrypted: mode === 'shared'
        ? null
        : Object.prototype.hasOwnProperty.call(fields, 'db_password')
          ? encrypt(fields.db_password)
          : existing?.db_password_encrypted ?? null,
      ssl_enabled: mode === 'shared' ? false : Boolean(fields.ssl_enabled ?? existing?.ssl_enabled),
    };

    await db.query(
      `INSERT INTO organization_database_configs
         (organization_id, isolation_mode, db_host, db_port, db_name, db_user, db_password_encrypted, ssl_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         isolation_mode = VALUES(isolation_mode),
         db_host = VALUES(db_host),
         db_port = VALUES(db_port),
         db_name = VALUES(db_name),
         db_user = VALUES(db_user),
         db_password_encrypted = VALUES(db_password_encrypted),
         ssl_enabled = VALUES(ssl_enabled)`,
      [
        orgId,
        row.isolation_mode,
        row.db_host,
        row.db_port,
        row.db_name,
        row.db_user,
        row.db_password_encrypted,
        row.ssl_enabled ? 1 : 0,
      ],
    );

    if (typeof db.invalidateTenantDbConfig === 'function') {
      await db.invalidateTenantDbConfig(orgId);
    }
    return this.findByOrgId(orgId);
  }

  static async markVerified(orgId) {
    const db = require('../config/database');
    await db.query(
      'UPDATE organization_database_configs SET last_verified_at = NOW() WHERE organization_id = ?',
      [orgId],
    );
  }

  static async listIsolatedRaw() {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT * FROM organization_database_configs
        WHERE isolation_mode = 'isolated'
          AND db_host IS NOT NULL
          AND db_name IS NOT NULL
          AND db_user IS NOT NULL`,
    );
    return rows;
  }

  static connectionFields() {
    return CONNECTION_FIELDS;
  }
}

module.exports = OrganizationDatabaseConfig;
