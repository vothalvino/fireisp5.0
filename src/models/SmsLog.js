// =============================================================================
// FireISP 5.0 — SmsLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SmsLog extends BaseModel {
  static get tableName() { return 'sms_logs'; }
  static get fillable() { return ['organization_id', 'recipient', 'message', 'channel', 'direction', 'status', 'error_message', 'sent_at']; }
  static get hasOrgScope() { return true; }
}

module.exports = SmsLog;
