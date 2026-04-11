// =============================================================================
// FireISP 5.0 — OrganizationMxProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class OrganizationMxProfile extends BaseModel {
  static get tableName() { return 'organization_mx_profiles'; }
  static get fillable() { return ['organization_id', 'rfc', 'razon_social', 'regimen_fiscal', 'codigo_postal_fiscal', 'calle', 'numero_exterior', 'numero_interior', 'colonia', 'municipio', 'estado', 'pais', 'pac_environment']; }
  static get hasOrgScope() { return false; }
}

module.exports = OrganizationMxProfile;
