// =============================================================================
// FireISP 5.0 — Organization Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Organization extends BaseModel {
  static get tableName() { return 'organizations'; }

  static get fillable() {
    return [
      'name', 'legal_name', 'email', 'phone', 'website',
      'address', 'city', 'state', 'zip_code', 'country', 'locale',
      'tax_id', 'logo_url', 'status',
    ];
  }

  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }

  /**
   * Get settings for this organization from the settings table.
   */
  static async getSettings(organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT `key`, `value`, `description` FROM settings WHERE organization_id = ? OR organization_id IS NULL ORDER BY organization_id ASC',
      [organizationId],
    );
    // Org-specific settings override global ones
    const map = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    return map;
  }

  /**
   * Update a single setting.
   */
  static async setSetting(organizationId, key, value) {
    const db = require('../config/database');
    await db.query(
      `INSERT INTO settings (organization_id, \`key\`, \`value\`)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
      [organizationId, key, value],
    );
  }
}

module.exports = Organization;
