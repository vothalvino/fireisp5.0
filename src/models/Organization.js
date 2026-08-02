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
      'privacy_notice', 'privacy_notice_version',
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
   * Return the regional-compliance locale for the given organization.
   * 'MX' enables the SAT/IFT compliance surface; anything else means global.
   * Falls back to 'global' if the org is not found or has no locale set.
   * @param {number|string} orgId
   * @returns {Promise<'global'|'MX'>}
   */
  static async getLocale(orgId, exec = null) {
    const db = require('../config/database');
    const sql = 'SELECT locale FROM organizations WHERE id = ? AND deleted_at IS NULL LIMIT 1';
    // `exec` lets a caller inside an open transaction run this on its own
    // connection. Without it, a call made while a transaction is held acquires
    // a SECOND connection from the same pool — and enough of those at once
    // exhaust the pool and hang, because acquisition has no timeout.
    const [rows] = exec ? await exec(sql, [orgId]) : await db.query(sql, [orgId]);
    return rows[0]?.locale || 'global';
  }

  // ---------------------------------------------------------------------------
  // Settings (split by migration 443 — j56)
  // ---------------------------------------------------------------------------
  // The old getSettings/setSetting pair took an organizationId and IGNORED it,
  // reading and writing the install-level `settings` table — which let any
  // org's admin rewrite values every other tenant read. Install and org
  // settings are now separate tables with separate methods; which keys belong
  // where is decided by src/services/settingsCatalog.js, not by callers.

  /**
   * Install-level settings rows (the operator-owned keys only — unknown keys
   * an operator may have hand-inserted are preserved in the table but never
   * served).
   * @returns {Promise<Array<{setting_key: string, setting_value: string|null, description: string|null}>>}
   */
  static async getInstallSettings() {
    const db = require('../config/database');
    const { INSTALL_SETTING_KEYS } = require('../services/settingsCatalog');
    // Keys are code constants (never user input); IN (?) does not expand under
    // the execute-backed db.query, so they are inlined.
    const inList = INSTALL_SETTING_KEYS.map((k) => `'${k}'`).join(', ');
    const [rows] = await db.query(
      `SELECT setting_key, setting_value, description FROM settings
        WHERE setting_key IN (${inList}) ORDER BY setting_key ASC`,
    );
    return rows;
  }

  /**
   * Update one install-level setting. The caller is responsible for the
   * operator gate and for allowlisting the key.
   */
  static async setInstallSetting(key, value) {
    const db = require('../config/database');
    await db.query(
      `INSERT INTO settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, value],
    );
  }

  /**
   * This organization's stored setting values, as a key→value map. Only keys
   * the org has actually set appear; callers merge catalog defaults.
   */
  static async getOrgSettings(organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT setting_key, setting_value FROM organization_settings WHERE organization_id = ?',
      [organizationId],
    );
    const map = {};
    for (const row of rows) map[row.setting_key] = row.setting_value;
    return map;
  }

  /**
   * Upsert one per-org setting. The caller is responsible for allowlisting
   * and validating (settingsCatalog.ORG_SETTING_DEFS).
   */
  static async setOrgSetting(organizationId, key, value) {
    const db = require('../config/database');
    await db.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [organizationId, key, value],
    );
  }
}

module.exports = Organization;
