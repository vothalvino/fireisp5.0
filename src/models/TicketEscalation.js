// =============================================================================
// FireISP 5.0 — Ticket Escalation Model
// =============================================================================
// Escalation chain for unresolved tickets (§1.3 Interaction Tracking). Stale
// tickets are auto-escalated by the `auto_escalate_tickets` scheduled task.
// See migration 196.
// =============================================================================

const BaseModel = require('./BaseModel');

class TicketEscalation extends BaseModel {
  static get tableName() { return 'ticket_escalations'; }

  static get fillable() {
    return [
      'organization_id', 'ticket_id', 'level', 'escalated_by', 'escalated_to',
      'reason', 'status', 'acknowledged_at', 'resolved_at', 'resolution_notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = TicketEscalation;
