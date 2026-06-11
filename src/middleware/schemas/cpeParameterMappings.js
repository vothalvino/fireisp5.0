// =============================================================================
// FireISP 5.0 — CPE Parameter Mapping Validation Schemas (§8.2)
// =============================================================================

const createCpeParameterMapping = {
  parameter_path: { type: 'string', required: true, min: 1, max: 512 },
  source_type: {
    type: 'string',
    required: true,
    enum: ['static', 'contract_field', 'plan_field', 'device_field'],
  },
  source_field: { type: 'string', max: 100 },
  static_value: { type: 'string', max: 10000 },
};

const updateCpeParameterMapping = {
  parameter_path: { type: 'string', min: 1, max: 512 },
  source_type: {
    type: 'string',
    enum: ['static', 'contract_field', 'plan_field', 'device_field'],
  },
  source_field: { type: 'string', max: 100 },
  static_value: { type: 'string', max: 10000 },
};

module.exports = { createCpeParameterMapping, updateCpeParameterMapping };
