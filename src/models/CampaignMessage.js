// =============================================================================
// FireISP 5.0 — CampaignMessage Model — §1.4
// =============================================================================

const BaseModel = require('./BaseModel');

class CampaignMessage extends BaseModel {
  static get tableName() { return 'campaign_messages'; }

  static get fillable() {
    return [
      'organization_id', 'campaign_id', 'client_id', 'recipient', 'channel',
      'status', 'provider_message_id', 'error_message', 'queued_at', 'sent_at',
      'delivered_at', 'opened_at', 'bounced_at',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = CampaignMessage;
