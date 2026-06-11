'use strict';

const createRule = {
  name:                     { type: 'string',  required: true,  min: 1, max: 255 },
  upstream_device_id:       { type: 'number',  required: false },
  downstream_device_id:     { type: 'number',  required: false },
  suppress_duration_minutes:{ type: 'number',  required: false },
  is_enabled:               { type: 'boolean', required: false },
};

const updateRule = {
  name:                     { type: 'string',  required: false, min: 1, max: 255 },
  upstream_device_id:       { type: 'number',  required: false },
  downstream_device_id:     { type: 'number',  required: false },
  suppress_duration_minutes:{ type: 'number',  required: false },
  is_enabled:               { type: 'boolean', required: false },
};

module.exports = { createRule, updateRule };
