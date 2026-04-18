// =============================================================================
// FireISP 5.0 — ContractTemplateMx Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ContractTemplateMx extends BaseModel {
  static get tableName() { return 'contract_templates_mx'; }
  static get fillable() { return ['organization_id', 'name', 'template_body', 'version', 'registro_profeco', 'registro_date', 'status']; }
  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = ContractTemplateMx;
