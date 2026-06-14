// =============================================================================
// FireISP 5.0 — EmailLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class EmailLog extends BaseModel {
  static get tableName() { return 'email_logs'; }
  static get fillable() { return ['client_id', 'user_id', 'channel', 'recipient', 'subject', 'body', 'template', 'template_id', 'campaign_message_id', 'reference_type', 'reference_id', 'status', 'error_message', 'sent_at']; }
  static get hasOrgScope() { return false; }
}

module.exports = EmailLog;
