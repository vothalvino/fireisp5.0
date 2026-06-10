// =============================================================================
// FireISP 5.0 — Follow-up Reminder Model
// =============================================================================
// Scheduled follow-ups per client (§1.3 Interaction Tracking). Due reminders
// are notified by the `follow_up_reminders` scheduled task. See migration 196.
// =============================================================================

const BaseModel = require('./BaseModel');

class FollowUpReminder extends BaseModel {
  static get tableName() { return 'follow_up_reminders'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'interaction_id', 'ticket_id', 'assigned_to',
      'title', 'notes', 'priority', 'status', 'due_at', 'notified_at',
      'completed_at', 'completed_by',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = FollowUpReminder;
