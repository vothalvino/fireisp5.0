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

module.exports = { generateXml, stamp, cancel };
