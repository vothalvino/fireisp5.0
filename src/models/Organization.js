// =============================================================================
// FireISP 5.0 — Organization Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Organization extends BaseModel {
  static get tableName() { return 'organizations'; }

  static get fillable() {
    return [
      'name', 'legal_name', 'email', 'phone', 'website',
      'address', 'city', 'state', 'zip_code', 'country', 'currency', 'locale',
      'tax_id', 'logo_url', 'status',
    ];
  }

  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }

  /**
   * Return the ISO 4217 currency code for the given organization.
   * Falls back to 'MXN' if the org is not found or has no currency set.
   * @param {number|string} orgId
   * @returns {Promise<string>}
   */
  static async getCurrency(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT currency FROM organizations WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [orgId],
    );
    return rows[0]?.currency || 'MXN';
  }

  /**
   * Get settings for this organization from the settings table.
   */
  static async getSettings(_organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT setting_key, setting_value, description FROM settings ORDER BY setting_key ASC',
    );
    const map = {};
    for (const row of rows) {
      map[row.setting_key ?? row.key] = row.setting_value ?? row.value;
    }
    return map;
  }

  /**
   * Update a single setting.
   */
  static async setSetting(_organizationId, key, value) {
    const db = require('../config/database');
    await db.query(
      `INSERT INTO settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, value],
    );
  }
}

module.exports = Organization;
