// =============================================================================
// FireISP 5.0 — Concession Title Validation Schemas
// =============================================================================

const createConcessionTitle = {
  title_number: { type: 'string', required: true, max: 100 },
  concession_type: { type: 'string', enum: ['commercial', 'public', 'social', 'community', 'indigenous', 'private'] },
  services_authorized: { type: 'string', max: 5000 },
  spectrum_bands: { type: 'string', max: 1000 },
  valid_from: { type: 'string' },
  valid_to: { type: 'string' },
  regulatory_body: { type: 'string', enum: ['IFT', 'CRT'] },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'expired', 'revoked', 'pending_renewal'] },
};

const updateConcessionTitle = {
  title_number: { type: 'string', max: 100 },
  concession_type: { type: 'string', enum: ['commercial', 'public', 'social', 'community', 'indigenous', 'private'] },
  services_authorized: { type: 'string', max: 5000 },
  spectrum_bands: { type: 'string', max: 1000 },
  valid_from: { type: 'string' },
  valid_to: { type: 'string' },
  regulatory_body: { type: 'string', enum: ['IFT', 'CRT'] },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'expired', 'revoked', 'pending_renewal'] },
};

module.exports = { createConcessionTitle, updateConcessionTitle };
