// =============================================================================
// FireISP 5.0 — AiPolicy Model
// =============================================================================
// One row per organization: master on/off switch, channel toggles, mode, tone,
// and a pointer to the currently active ai_providers row.
// =============================================================================

const BaseModel = require('./BaseModel');

class AiPolicy extends BaseModel {
  static get tableName() { return 'ai_policies'; }

  static get fillable() {
    return [
      'organization_id',
      'enabled',
      'enabled_channels',
      'mode',
      'auto_send_confidence',
      'default_locale',
      'tone',
      'redact_pii_before_llm',
      'active_provider_id',
    ];
  }

  static get hasOrgScope() { return true; }

  /**
   * Return the policy row for an org, or a safe default when none exists yet.
   * @param {number} orgId
   * @returns {Promise<object>}
   */
  static async findByOrgId(orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM ai_policies WHERE organization_id = ?',
      [orgId],
    );
    return rows[0] || {
      organization_id: orgId,
      enabled: 0,
      enabled_channels: { portal: false, email: false, whatsapp: false, sms: false },
      mode: 'draft_only',
      auto_send_confidence: '0.85',
      default_locale: 'es-MX',
      tone: 'formal',
      redact_pii_before_llm: 1,
      active_provider_id: null,
    };
  }

  /**
   * Upsert policy settings for an org.
   * @param {number} orgId
   * @param {object} fields
   * @returns {Promise<object>}
   */
  static async upsert(orgId, fields) {
    const db = require('../config/database');
    const allowed = [
      'enabled', 'enabled_channels', 'mode', 'auto_send_confidence',
      'default_locale', 'tone', 'redact_pii_before_llm', 'active_provider_id',
    ];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        updates[key] = fields[key];
      }
    }
    if (Object.keys(updates).length === 0) return this.findByOrgId(orgId);

    // Serialize JSON fields
    if (updates.enabled_channels !== undefined && typeof updates.enabled_channels === 'object') {
      updates.enabled_channels = JSON.stringify(updates.enabled_channels);
    }

    const setCols = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    const values = Object.values(updates);
    await db.query(
      `INSERT INTO ai_policies (organization_id, ${Object.keys(updates).map(k => `\`${k}\``).join(', ')})
       VALUES (?, ${values.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setCols}`,
      [orgId, ...values, ...values],
    );
    return this.findByOrgId(orgId);
  }
}

module.exports = AiPolicy;
