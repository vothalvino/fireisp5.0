// =============================================================================
// FireISP 5.0 — Validation Schemas: legal document templates + signing (447)
// =============================================================================

const TEMPLATE_TYPES = ['installation_authorization', 'activation_contract', 'equipment_comodato', 'custom'];

const createDocumentTemplate = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  template_type: { type: 'string', required: true, enum: TEMPLATE_TYPES },
  body_md: { type: 'string', required: true, min: 1, max: 500000 },
  is_active: { type: 'boolean' },
};

const updateDocumentTemplate = {
  name: { type: 'string', min: 1, max: 200 },
  template_type: { type: 'string', enum: TEMPLATE_TYPES },
  body_md: { type: 'string', min: 1, max: 500000 },
  is_active: { type: 'boolean' },
};

const signDocument = {
  signer_name: { type: 'string', required: true, min: 1, max: 200 },
  // Data-URL PNG/JPEG from the signature canvas; service enforces format/size.
  signature_image: { type: 'string', required: true, min: 30, max: 700000 },
};

const generateDocuments = {
  service_order_id: { type: 'number', required: true, min: 1 },
};

module.exports = { createDocumentTemplate, updateDocumentTemplate, signDocument, generateDocuments, TEMPLATE_TYPES };
