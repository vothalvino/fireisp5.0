// =============================================================================
// FireISP 5.0 — OrganizationQuota Model
// =============================================================================

const BaseModel = require('./BaseModel');

class OrganizationQuota extends BaseModel {
  static get tableName() { return 'organization_quotas'; }

  static get fillable() {
    return ['organization_id', 'max_clients', 'max_devices', 'max_storage_mb', 'max_scheduled_tasks', 'max_ai_tokens_month'];
  }

  /** Not org-scoped — this table IS the quota config, keyed by organization_id. */
  static get hasOrgScope() { return false; }

  /**
   * Find quota row by org, or return a default "unlimited" object when no row exists.
   */
  static async findByOrgId(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM organization_quotas WHERE organization_id = ?',
      [orgId],
    );
    return rows[0] || {
      organization_id: orgId,
      max_clients: null,
      max_devices: null,
      max_storage_mb: null,
      max_scheduled_tasks: null,
      max_ai_tokens_month: null,
    };
  }

  /**
   * Upsert quota settings for an org.
   */
  static async upsert(orgId, fields) {
    const db = require('../config/database');
    const allowed = ['max_clients', 'max_devices', 'max_storage_mb', 'max_scheduled_tasks', 'max_ai_tokens_month'];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        updates[key] = fields[key] === '' ? null : fields[key];
      }
    }
    if (Object.keys(updates).length === 0) return this.findByOrgId(orgId);

    const setCols = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    const values = Object.values(updates);
    await db.query(
      `INSERT INTO organization_quotas (organization_id, ${Object.keys(updates).map(k => `\`${k}\``).join(', ')})
       VALUES (?, ${values.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setCols}`,
      [orgId, ...values, ...values],
    );
    return this.findByOrgId(orgId);
  }
}

module.exports = OrganizationQuota;
