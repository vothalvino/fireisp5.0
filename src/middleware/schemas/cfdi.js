// =============================================================================
// FireISP 5.0 — CFDI Validation Schemas
// =============================================================================

const generateXml = {
  cfdi_document_id: { type: 'number', required: true, min: 1 },
};

const stamp = {
  cfdi_document_id: { type: 'number', required: true, min: 1 },
};

const cancel = {
  cfdi_document_id: { type: 'number', required: true, min: 1 },
  reason: { type: 'string', required: true, enum: ['01', '02', '03', '04'] },
  replacement_uuid: { type: 'string' },
};

// Related document entry inside a payment complement request
const relatedDocumentItem = {
  related_cfdi_uuid: { type: 'string', required: true },
  serie: { type: 'string' },
  folio: { type: 'string' },
  moneda_dr: { type: 'string' },
  equivalencia_dr: { type: 'number' },
  num_parcialidad: { type: 'number', min: 1 },
  imp_saldo_ant: { type: 'number', required: true, min: 0 },
  imp_pagado: { type: 'number', required: true, min: 0 },
  imp_saldo_insoluto: { type: 'number', required: true, min: 0 },
};

const paymentComplement = {
  client_id: { type: 'number', required: true, min: 1 },
  payment_id: { type: 'number', min: 1 },
  serie: { type: 'string' },
  folio: { type: 'string' },
  fecha_emision: { type: 'string', required: true },
  lugar_expedicion: { type: 'string', required: true },
  emisor_rfc: { type: 'string', required: true },
  emisor_nombre: { type: 'string', required: true },
  emisor_regimen_fiscal: { type: 'string', required: true },
  receptor_rfc: { type: 'string', required: true },
  receptor_nombre: { type: 'string', required: true },
  receptor_domicilio_fiscal: { type: 'string', required: true },
  receptor_regimen_fiscal: { type: 'string', required: true },
  payment_date: { type: 'string', required: true },
  forma_pago: { type: 'string', required: true },
  moneda: { type: 'string', required: true },
  tipo_cambio: { type: 'number', min: 0 },
  amount: { type: 'number', required: true, min: 0 },
  operation_number: { type: 'string' },
  payer_rfc: { type: 'string' },
  payer_bank_name: { type: 'string' },
  payer_account: { type: 'string' },
  beneficiary_rfc: { type: 'string' },
  beneficiary_account: { type: 'string' },
  related_documents: { type: 'array', required: true, items: relatedDocumentItem },
};

module.exports = { generateXml, stamp, cancel, paymentComplement };
