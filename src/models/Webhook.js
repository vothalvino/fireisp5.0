// =============================================================================
// FireISP 5.0 — Webhook Model
// =============================================================================

const BaseModel = require('./BaseModel');
const { encrypt } = require('../utils/encryption');

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
   *    encrypted with the standard AES-256-GCM envelope before persistence
   *  - serialize `events` (CSV string or array) into the JSON-array string the
   *    JSON NOT NULL `events` column requires
   * @param {object} data
   * @returns {object}
   */
  static normalizeInput(data) {
    const out = { ...data };
    // Never accept the storage column from an API/direct model caller. Only
    // the plaintext `secret` input below may produce an encrypted envelope.
    delete out.secret_encrypted;
    if (out.secret !== undefined) {
      out.secret_encrypted = encrypt(out.secret);
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

  static async getDeliveries(webhookId, organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT wd.id, wd.webhook_id, wd.event_name, wd.http_status_code,
              wd.response_time_ms, wd.attempt_number, wd.status,
              wd.next_retry_at, wd.delivered_at, wd.created_at,
              w.organization_id AS webhook_organization_id
         FROM webhook_deliveries wd
         JOIN webhooks w ON w.id = wd.webhook_id
        WHERE wd.webhook_id = ? AND w.organization_id = ?
          AND w.deleted_at IS NULL
        ORDER BY wd.created_at DESC LIMIT 50`,
      [webhookId, organizationId],
    );
    return rows
      .filter(row => Number(row.webhook_organization_id) === Number(organizationId))
      .map(({ webhook_organization_id: _organizationId, ...row }) => row);
  }
}

module.exports = Webhook;
