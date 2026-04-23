// =============================================================================
// FireISP 5.0 — SmsLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SmsLog extends BaseModel {
  static get tableName() { return 'sms_logs'; }
  static get fillable() { return ['organization_id', 'client_id', 'phone_number', 'channel', 'direction', 'template_id', 'message_body', 'provider', 'provider_message_id', 'status', 'error_code', 'error_message', 'cost', 'sent_at', 'delivered_at']; }
  static get hasOrgScope() { return true; }
}

module.exports = SmsLog;
