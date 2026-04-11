// =============================================================================
// FireISP 5.0 — CfdiConcepto Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CfdiConcepto extends BaseModel {
  static get tableName() { return 'cfdi_conceptos'; }
  static get fillable() { return ['cfdi_document_id', 'clave_prod_serv', 'no_identificacion', 'cantidad', 'clave_unidad', 'unidad', 'descripcion', 'valor_unitario', 'importe', 'descuento', 'objeto_imp']; }
  static get hasOrgScope() { return false; }
}

module.exports = CfdiConcepto;
