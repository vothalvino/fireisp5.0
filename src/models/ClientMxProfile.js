// =============================================================================
// FireISP 5.0 — ClientMxProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ClientMxProfile extends BaseModel {
  static get tableName() { return 'client_mx_profiles'; }
  static get fillable() { return ['client_id', 'rfc', 'curp', 'razon_social', 'regimen_fiscal', 'codigo_postal_fiscal']; }
  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = ClientMxProfile;
