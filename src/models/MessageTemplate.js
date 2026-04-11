// =============================================================================
// FireISP 5.0 — MessageTemplate Model
// =============================================================================

const BaseModel = require('./BaseModel');

class MessageTemplate extends BaseModel {
  static get tableName() { return 'message_templates'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'channel', 'subject', 'body', 'variables',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = MessageTemplate;
