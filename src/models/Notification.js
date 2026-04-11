// =============================================================================
// FireISP 5.0 — Notification Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Notification extends BaseModel {
  static get tableName() { return 'notifications'; }

  static get fillable() {
    return [
      'organization_id', 'user_id', 'type', 'title', 'message', 'read_at',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = Notification;
