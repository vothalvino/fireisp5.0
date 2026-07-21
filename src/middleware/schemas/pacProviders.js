// =============================================================================
// FireISP 5.0 — PAC Provider Validation Schemas
// =============================================================================

const createPacProvider = {
  provider_name: { type: 'string', required: true, enum: ['finkok', 'sw_sapien', 'digicel', 'comercio_digital', 'facturapi', 'other', 'simulator'] },
  // label + api_url are NOT NULL columns with no default — an absent value
  // used to surface as a raw 500 from MySQL instead of a 422.
  label: { type: 'string', required: true, max: 100 },
  api_url: { type: 'string', required: true, max: 500 },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  seal_mode: { type: 'string', enum: ['pac', 'local'] },
  priority: { type: 'number', min: 0, max: 1000 },
  username_encrypted: { type: 'string', max: 500 },
  password_encrypted: { type: 'string', max: 500 },
  // SW "infinite token" (portal ADT) — alternative to user+password.
  token_encrypted: { type: 'string', max: 2000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updatePacProvider = {
  provider_name: { type: 'string', enum: ['finkok', 'sw_sapien', 'digicel', 'comercio_digital', 'facturapi', 'other', 'simulator'] },
  label: { type: 'string', max: 100 },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  seal_mode: { type: 'string', enum: ['pac', 'local'] },
  priority: { type: 'number', min: 0, max: 1000 },
  username_encrypted: { type: 'string', max: 500 },
  password_encrypted: { type: 'string', max: 500 },
  token_encrypted: { type: 'string', max: 2000 },
  api_url: { type: 'string', max: 500 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createPacProvider, updatePacProvider };
