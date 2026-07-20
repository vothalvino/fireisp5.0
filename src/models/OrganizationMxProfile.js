// =============================================================================
// FireISP 5.0 — OrganizationMxProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class OrganizationMxProfile extends BaseModel {
  static get tableName() { return 'organization_mx_profiles'; }
  // Aligned to the REAL table columns (the old list carried calle/
  // numero_exterior/numero_interior/estado/pais — none exist; real address
  // columns are exterior_number/interior_number/colonia/municipio).
  // CSD (csd_*) and PAC (pac_*) columns are deliberately NOT fillable: live
  // CSDs are managed via /csd-certificates and PAC credentials via
  // /pac-providers — the profile's copies are legacy storage that must not be
  // writable through this surface.
  static get fillable() {
    return [
      'organization_id', 'rfc', 'razon_social', 'regimen_fiscal',
      'codigo_postal_fiscal', 'colonia', 'municipio',
      'exterior_number', 'interior_number',
      'cfdi_serie_ingreso', 'cfdi_serie_egreso', 'cfdi_serie_pago',
    ];
  }
  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = OrganizationMxProfile;
