'use strict';

const createConnectionSchema = {
  provider_id: { type: 'number', required: true },
  name: { type: 'string', required: true, min: 1, max: 255 },
  credentials: { type: 'object' },
  config_json: { type: 'object' },
  is_enabled: { type: 'boolean' },
};

const updateConnectionSchema = {
  name: { type: 'string', min: 1, max: 255 },
  credentials: { type: 'object' },
  config_json: { type: 'object' },
  status: { type: 'string', enum: ['active', 'error', 'disabled', 'pending'] },
  is_enabled: { type: 'boolean' },
};

module.exports = { createConnectionSchema, updateConnectionSchema };
