// =============================================================================
// FireISP 5.0 — ProvisioningPipeline Model (§18.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class ProvisioningPipeline extends BaseModel {
  static get tableName() { return 'provisioning_pipelines'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'contract_id', 'client_id',
      'status', 'current_stage', 'stages_config', 'stages_results',
      'started_at', 'completed_at', 'error_message', 'triggered_by',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = ProvisioningPipeline;
