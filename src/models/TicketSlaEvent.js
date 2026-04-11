// =============================================================================
// FireISP 5.0 — TicketSlaEvent Model
// =============================================================================

const BaseModel = require('./BaseModel');

class TicketSlaEvent extends BaseModel {
  static get tableName() { return 'ticket_sla_events'; }

  static get fillable() {
    return [
      'organization_id', 'ticket_id', 'sla_definition_id', 'event_type',
      'occurred_at', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = TicketSlaEvent;
