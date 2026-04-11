// =============================================================================
// FireISP 5.0 — Service Area Validation Schemas
// =============================================================================

const createServiceArea = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  boundary: { type: 'string', max: 65000 },
  color: { type: 'string', max: 7 },
  status: { type: 'string', enum: ['planned', 'active', 'retired'] },
};

const updateServiceArea = {
  name: { type: 'string', min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  boundary: { type: 'string', max: 65000 },
  color: { type: 'string', max: 7 },
  status: { type: 'string', enum: ['planned', 'active', 'retired'] },
};

module.exports = { createServiceArea, updateServiceArea };
