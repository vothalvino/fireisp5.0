// =============================================================================
// FireISP 5.0 — CFDI Document Validation Schemas
// =============================================================================

// Aligned to the REAL cfdi_documents columns (the old shape accepted
// `descuento`/`lugar_expedicion`/`notes`, none of which exist on the table —
// lugar de expedición comes from organization_mx_profiles at XML time).
// client_id is required: the column is NOT NULL with no default.
const createCfdiDocument = {
  client_id: { type: 'number', required: true, min: 1 },
  invoice_id: { type: 'number', min: 1 },
  credit_note_id: { type: 'number', min: 1 },
  payment_id: { type: 'number', min: 1 },
  tipo_comprobante: { type: 'string', required: true, max: 1 },
  serie: { type: 'string', max: 10 },
  folio: { type: 'number', min: 0 },
  forma_pago: { type: 'string', max: 2 },
  metodo_pago: { type: 'string', max: 3 },
  uso_cfdi: { type: 'string', required: true, max: 4 },
  moneda: { type: 'string', max: 3 },
  tipo_cambio: { type: 'number', min: 0 },
  exportacion: { type: 'string', enum: ['01', '02', '03'] },
  receptor_rfc: { type: 'string', max: 13 },
  receptor_nombre: { type: 'string', max: 300 },
  receptor_regimen: { type: 'string', max: 3 },
  receptor_cp: { type: 'string', max: 5 },
  subtotal: { type: 'number', min: 0 },
  total_impuestos: { type: 'number', min: 0 },
  total: { type: 'number', min: 0 },
};

const updateCfdiDocument = {
  serie: { type: 'string', max: 10 },
  folio: { type: 'number', min: 0 },
  forma_pago: { type: 'string', max: 2 },
  metodo_pago: { type: 'string', max: 3 },
  uso_cfdi: { type: 'string', max: 4 },
  moneda: { type: 'string', max: 3 },
  tipo_cambio: { type: 'number', min: 0 },
  exportacion: { type: 'string', enum: ['01', '02', '03'] },
  receptor_rfc: { type: 'string', max: 13 },
  receptor_nombre: { type: 'string', max: 300 },
  receptor_regimen: { type: 'string', max: 3 },
  receptor_cp: { type: 'string', max: 5 },
};

const cancelCfdiDocument = {
  cancellation_reason: { type: 'string', required: true, enum: ['01', '02', '03', '04'] },
  replacement_uuid: { type: 'string', max: 36 },
};

module.exports = { createCfdiDocument, updateCfdiDocument, cancelCfdiDocument };
