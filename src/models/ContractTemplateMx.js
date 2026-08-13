// =============================================================================
// FireISP 5.0 — ContractTemplateMx Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ContractTemplateMx extends BaseModel {
  static get tableName() { return 'contract_templates_mx'; }
  static get fillable() {
    return [
      'organization_id', 'template_name', 'ift_registration_number',
      'registered_at', 'version', 'template_body', 'document_file_id',
      'environment', 'status',
    ];
  }
  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = ContractTemplateMx;
