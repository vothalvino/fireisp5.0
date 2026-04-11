// =============================================================================
// FireISP 5.0 — CfdiDocument Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CfdiDocument extends BaseModel {
  static get tableName() { return 'cfdi_documents'; }

  static get fillable() {
    return [
      'organization_id', 'invoice_id', 'credit_note_id', 'payment_id',
      'tipo_comprobante', 'serie', 'folio', 'folio_fiscal',
      'fecha_emision', 'lugar_expedicion', 'exportacion', 'emisor_rfc',
      'emisor_nombre', 'emisor_regimen_fiscal', 'receptor_rfc',
      'receptor_nombre', 'receptor_regimen_fiscal',
      'receptor_domicilio_fiscal', 'uso_cfdi', 'metodo_pago',
      'forma_pago', 'moneda', 'tipo_cambio', 'subtotal', 'total',
      'descuento', 'signed_xml', 'xml_file_id', 'pdf_file_id',
      'pac_provider_id', 'stamped_at', 'cancelled_at', 'sat_status',
      'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static async getConceptos(cfdiId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM cfdi_conceptos WHERE cfdi_document_id = ? ORDER BY id',
      [cfdiId],
    );
    return rows;
  }

  static async getRelatedDocuments(cfdiId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM cfdi_related_documents WHERE cfdi_document_id = ? ORDER BY id',
      [cfdiId],
    );
    return rows;
  }
}

module.exports = CfdiDocument;
