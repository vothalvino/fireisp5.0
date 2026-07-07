// =============================================================================
// FireISP 5.0 — Concession Title Validation Schemas
// =============================================================================

const createConcessionTitle = {
  title_number: { type: 'string', required: true, max: 100 },
  concession_type: { type: 'string', enum: ['commercial', 'public', 'social', 'community', 'indigenous', 'private'] },
  services_authorized: { type: 'string', required: true, max: 5000 },
  geographic_scope: { type: 'string', max: 10000 },
  spectrum_bands: { type: 'string', max: 1000 },
  granted_date: { type: 'string', required: true },
  expiration_date: { type: 'string' },
  renewal_filed_at: { type: 'string' },
  regulatory_body: { type: 'string', enum: ['IFT', 'CRT'] },
  document_file_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'expired', 'revoked', 'pending_renewal'] },
};

const updateConcessionTitle = {
  title_number: { type: 'string', max: 100 },
  concession_type: { type: 'string', enum: ['commercial', 'public', 'social', 'community', 'indigenous', 'private'] },
  services_authorized: { type: 'string', max: 5000 },
  geographic_scope: { type: 'string', max: 10000 },
  spectrum_bands: { type: 'string', max: 1000 },
  granted_date: { type: 'string' },
  expiration_date: { type: 'string' },
  renewal_filed_at: { type: 'string' },
  regulatory_body: { type: 'string', enum: ['IFT', 'CRT'] },
  document_file_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'expired', 'revoked', 'pending_renewal'] },
};

module.exports = { createConcessionTitle, updateConcessionTitle };
