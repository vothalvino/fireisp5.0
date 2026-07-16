// =============================================================================
// FireISP 5.0 — Notification Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Notification extends BaseModel {
  static get tableName() { return 'notifications'; }

  // Mirrors the actual notifications columns. The previous list declared
  // organization_id and message — neither column exists (the body column is
  // `body`), so every Notification.create() threw "Unknown column" and the
  // one feature using it (AI-reply agent notification) silently never worked.
  static get fillable() {
    return [
      'user_id', 'type', 'title', 'body', 'entity_type', 'entity_id',
      'is_read', 'read_at',
    ];
  }

  // The table is user-scoped (no organization_id column); org isolation comes
  // from only ever querying by the authenticated user's id.
  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = Notification;
