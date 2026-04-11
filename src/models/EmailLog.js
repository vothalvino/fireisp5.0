// =============================================================================
// FireISP 5.0 — EmailLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class EmailLog extends BaseModel {
  static get tableName() { return 'email_logs'; }
  static get fillable() { return ['organization_id', 'recipient', 'subject', 'body_html', 'body_text', 'channel', 'status', 'error_message', 'sent_at']; }
  static get hasOrgScope() { return true; }
}

module.exports = EmailLog;
