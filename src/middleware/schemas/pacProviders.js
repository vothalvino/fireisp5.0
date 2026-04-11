// =============================================================================
// FireISP 5.0 — PAC Provider Validation Schemas
// =============================================================================

const createPacProvider = {
  provider_name: { type: 'string', required: true, enum: ['finkok', 'sw_sapien', 'digicel', 'comercio_digital', 'facturapi', 'other'] },
  label: { type: 'string', max: 255 },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  username: { type: 'string', max: 255 },
  password_encrypted: { type: 'string', max: 500 },
  api_url: { type: 'string', max: 500 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updatePacProvider = {
  provider_name: { type: 'string', enum: ['finkok', 'sw_sapien', 'digicel', 'comercio_digital', 'facturapi', 'other'] },
  label: { type: 'string', max: 255 },
  environment: { type: 'string', enum: ['sandbox', 'production'] },
  username: { type: 'string', max: 255 },
  password_encrypted: { type: 'string', max: 500 },
  api_url: { type: 'string', max: 500 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createPacProvider, updatePacProvider };
