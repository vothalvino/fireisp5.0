// =============================================================================
// FireISP 5.0 — CommunicationCampaign Model — §1.4
// =============================================================================

const BaseModel = require('./BaseModel');

class CommunicationCampaign extends BaseModel {
  static get tableName() { return 'communication_campaigns'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'channel', 'status', 'template_id',
      'filter_status', 'filter_plan_id', 'filter_tag', 'recipient_count',
      'sent_count', 'delivered_count', 'opened_count', 'bounced_count',
      'failed_count', 'scheduled_at', 'started_at', 'completed_at',
      'notes', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = CommunicationCampaign;
