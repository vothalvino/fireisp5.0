// =============================================================================
// FireISP 5.0 — WinbackCampaign Model
// =============================================================================
// Win-back campaigns for cancelled customers (§1.2 Customer Lifecycle).
// See migration 193.
// =============================================================================

const BaseModel = require('./BaseModel');

class WinbackCampaign extends BaseModel {
  static get tableName() { return 'winback_campaigns'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'status', 'target_segment', 'offer_description',
      'discount_percent', 'message_template_id', 'start_date', 'end_date', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = WinbackCampaign;
