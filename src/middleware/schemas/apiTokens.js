// =============================================================================
// FireISP 5.0 — API Token Validation Schemas
// =============================================================================

const createApiToken = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  scopes: { type: 'string', max: 2000 },
  expires_at: { type: 'string' },
};

const updateApiToken = {
  name: { type: 'string', min: 1, max: 255 },
  scopes: { type: 'string', max: 2000 },
  expires_at: { type: 'string' },
  revoked_at: { type: 'string' },
};

module.exports = { createApiToken, updateApiToken };
