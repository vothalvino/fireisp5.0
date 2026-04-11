// =============================================================================
// FireISP 5.0 — Webhook Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Webhook extends BaseModel {
  static get tableName() { return 'webhooks'; }

  static get fillable() {
    return [
      'organization_id', 'url', 'secret_encrypted', 'events',
      'max_retries', 'timeout_seconds', 'is_enabled', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static async getDeliveries(webhookId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50',
      [webhookId],
    );
    return rows;
  }
}

module.exports = Webhook;
