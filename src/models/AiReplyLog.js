// =============================================================================
// FireISP 5.0 — AiReplyLog Model
// =============================================================================
// Immutable audit trail for every AI draft/send action. Records the full
// context snapshot, prompt hash, token usage, cost, and final action taken by
// the reviewer (proposed / edited / sent / auto_sent / discarded / failed).
// =============================================================================

const BaseModel = require('./BaseModel');

class AiReplyLog extends BaseModel {
  static get tableName() { return 'ai_reply_logs'; }

  static get fillable() {
    return [
      'organization_id',
      'ticket_id',
      'provider_id',
      'classification',
      'confidence',
      'context_snapshot',
      'prompt_hash',
      'draft_text',
      'final_text',
      'action',
      'reviewer_user_id',
      'prompt_tokens',
      'completion_tokens',
      'cost_usd',
      'duration_ms',
      'error',
    ];
  }

  static get hasOrgScope() { return true; }

  // Logs are never soft-deleted (they are the audit trail).
  static get softDelete() { return false; }
}

module.exports = AiReplyLog;
