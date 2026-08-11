// =============================================================================
// FireISP 5.0 — Validation Schemas: legal document templates + signing (447)
// =============================================================================

const TEMPLATE_TYPES = ['installation_authorization', 'activation_contract', 'equipment_comodato', 'custom'];

const createDocumentTemplate = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  template_type: { type: 'string', required: true, enum: TEMPLATE_TYPES },
  body_md: { type: 'string', required: true, min: 1, max: 500000 },
  contract_template_mx_id: { type: 'number', min: 1 },
  is_active: { type: 'boolean' },
};

const updateDocumentTemplate = {
  name: { type: 'string', min: 1, max: 200 },
  template_type: { type: 'string', enum: TEMPLATE_TYPES },
  body_md: { type: 'string', min: 1, max: 500000 },
  contract_template_mx_id: { type: 'number', min: 1 },
  is_active: { type: 'boolean' },
};

const signDocument = {
  signer_name: { type: 'string', required: true, min: 1, max: 200 },
  // Data-URL PNG/JPEG from the signature canvas; service enforces format/size.
  signature_image: { type: 'string', required: true, min: 30, max: 500000 },
  // Required by the service for activation/handoff documents; optional here
  // because arrival-authorization signatures do not capture marketing choices.
  communication_opt_ins: {
    type: 'object',
    properties: {
      email: { type: 'boolean' },
      sms: { type: 'boolean' },
      whatsapp: { type: 'boolean' },
    },
    requiredProperties: ['email', 'sms', 'whatsapp'],
  },
  communication_choices_confirmed: { type: 'boolean' },
  // Pins the evidence row to the exact notice rendered on the signing screen.
  // The service compares both values against the current server-owned notice.
  privacy_notice_version: { type: 'string', min: 1, max: 20 },
  privacy_notice_hash: { type: 'string', min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ },
};

const generateDocuments = {
  service_order_id: { type: 'number', required: true, min: 1 },
};

module.exports = { createDocumentTemplate, updateDocumentTemplate, signDocument, generateDocuments, TEMPLATE_TYPES };
