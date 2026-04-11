// =============================================================================
// FireISP 5.0 — CFDI Document Validation Schemas
// =============================================================================

const createCfdiDocument = {
  client_id: { type: 'number', min: 1 },
  invoice_id: { type: 'number', min: 1 },
  tipo_comprobante: { type: 'string', required: true, max: 1 },
  serie: { type: 'string', max: 25 },
  folio: { type: 'string', max: 40 },
  forma_pago: { type: 'string', max: 2 },
  metodo_pago: { type: 'string', max: 3 },
  uso_cfdi: { type: 'string', max: 4 },
  moneda: { type: 'string', max: 3 },
  tipo_cambio: { type: 'number', min: 0 },
  exportacion: { type: 'string', enum: ['01', '02', '03'] },
  subtotal: { type: 'number', min: 0 },
  descuento: { type: 'number', min: 0 },
  total: { type: 'number', min: 0 },
  lugar_expedicion: { type: 'string', max: 5 },
  notes: { type: 'string', max: 5000 },
};

const updateCfdiDocument = {
  serie: { type: 'string', max: 25 },
  folio: { type: 'string', max: 40 },
  forma_pago: { type: 'string', max: 2 },
  metodo_pago: { type: 'string', max: 3 },
  uso_cfdi: { type: 'string', max: 4 },
  moneda: { type: 'string', max: 3 },
  tipo_cambio: { type: 'number', min: 0 },
  exportacion: { type: 'string', enum: ['01', '02', '03'] },
  notes: { type: 'string', max: 5000 },
};

const cancelCfdiDocument = {
  cancellation_reason: { type: 'string', required: true, enum: ['01', '02', '03', '04'] },
  replacement_uuid: { type: 'string', max: 36 },
};

module.exports = { createCfdiDocument, updateCfdiDocument, cancelCfdiDocument };
