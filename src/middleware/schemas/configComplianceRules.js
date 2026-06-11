const createRule = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  rule_type: { type: 'string', required: true, enum: ['must_contain', 'must_not_contain', 'regex_match', 'regex_not_match'] },
  pattern: { type: 'string', required: true, min: 1 },
  severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
  applies_to_device_type: { type: 'string', max: 50 },
  is_enabled: { type: 'boolean' },
};

const updateRule = {
  name: { type: 'string', min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  rule_type: { type: 'string', enum: ['must_contain', 'must_not_contain', 'regex_match', 'regex_not_match'] },
  pattern: { type: 'string', min: 1 },
  severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
  applies_to_device_type: { type: 'string', max: 50 },
  is_enabled: { type: 'boolean' },
};

module.exports = { createRule, updateRule };
