// =============================================================================
// FireISP 5.0 — Client Interaction Model
// =============================================================================
// Manual interaction log — calls, visits, chats (§1.3 Interaction Tracking).
// See migration 196.
// =============================================================================

const BaseModel = require('./BaseModel');

class ClientInteraction extends BaseModel {
  static get tableName() { return 'client_interactions'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'user_id', 'interaction_type', 'direction',
      'subject', 'notes', 'occurred_at', 'duration_minutes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = ClientInteraction;
