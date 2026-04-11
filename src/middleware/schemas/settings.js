// =============================================================================
// FireISP 5.0 — Settings Validation Schemas
// =============================================================================

const updateSetting = {
  value: { type: 'string', required: true, max: 5000 },
  description: { type: 'string', max: 500 },
};

module.exports = { updateSetting };
