// =============================================================================
// FireISP 5.0 — Webhook Model
// =============================================================================

const BaseModel = require('./BaseModel');

/**
 * Serialize an event subscription list into the JSON-array string the
 * `events` JSON NOT NULL column requires. Accepts either an array or a
 * comma-separated string (and passes through an existing JSON-array string
 * so an edit round-trip does not double-encode).
 * @param {string|string[]} events
 * @returns {string} JSON-array string, e.g. '["invoice.created"]'
 */
function serializeEvents(events) {
  let list;
  if (Array.isArray(events)) {
    list = events;
  } else if (typeof events === 'string') {
    const trimmed = events.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed) ? parsed : [trimmed];
      } catch (_e) {
        list = trimmed.split(',');
      }
    } else {
      list = trimmed.split(',');
    }
  } else {
    list = [];
  }
  const cleaned = list.map(e => String(e).trim()).filter(Boolean);
  return JSON.stringify(cleaned);
}

class Webhook extends BaseModel {
  static get tableName() { return 'webhooks'; }

  static get fillable() {
    return [
      'organization_id', 'url', 'secret_encrypted', 'events',
      'max_retries', 'timeout_seconds', 'is_active',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Normalize an incoming create/update payload onto the real webhooks columns:
   *  - map the request's `secret` field onto the `secret_encrypted` column
   *    (stored as-is — the delivery service reads it directly as the HMAC key;
   *    no encryption layer is applied here)
   *  - serialize `events` (CSV string or array) into the JSON-array string the
   *    JSON NOT NULL `events` column requires
   * @param {object} data
   * @returns {object}
   */
  static normalizeInput(data) {
    const out = { ...data };
    if (out.secret !== undefined) {
      out.secret_encrypted = out.secret;
      delete out.secret;
    }
    if (out.events !== undefined) {
      out.events = serializeEvents(out.events);
    }
    return out;
  }

  static async create(data) {
    return super.create(this.normalizeInput(data));
  }

  static async update(id, data, orgId = null) {
    return super.update(id, this.normalizeInput(data), orgId);
  }

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
