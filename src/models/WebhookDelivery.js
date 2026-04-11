// =============================================================================
// FireISP 5.0 — WebhookDelivery Model
// =============================================================================

const BaseModel = require('./BaseModel');

class WebhookDelivery extends BaseModel {
  static get tableName() { return 'webhook_deliveries'; }
  static get fillable() { return ['webhook_id', 'event', 'request_body', 'response_status', 'response_body', 'response_time_ms', 'attempt', 'status']; }
  static get hasOrgScope() { return false; }
}

module.exports = WebhookDelivery;
