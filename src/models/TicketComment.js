// =============================================================================
// FireISP 5.0 — TicketComment Model
// =============================================================================

const BaseModel = require('./BaseModel');

class TicketComment extends BaseModel {
  static get tableName() { return 'ticket_comments'; }

  static get fillable() {
    return [
      'ticket_id', 'user_id', 'body', 'is_internal',
    ];
  }

  static get hasOrgScope() { return false; }
}

module.exports = TicketComment;
