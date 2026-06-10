// =============================================================================
// FireISP 5.0 — Satisfaction Survey Model
// =============================================================================
// NPS / CSAT surveys (§1.3 Interaction Tracking). CSAT surveys are dispatched
// automatically for resolved tickets by the `dispatch_satisfaction_surveys`
// scheduled task. See migration 196.
// =============================================================================

const BaseModel = require('./BaseModel');

class SatisfactionSurvey extends BaseModel {
  static get tableName() { return 'satisfaction_surveys'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'ticket_id', 'interaction_id',
      'survey_type', 'channel', 'status', 'score', 'comment',
      'sent_at', 'responded_at',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = SatisfactionSurvey;
