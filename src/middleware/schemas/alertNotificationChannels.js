'use strict';

const createChannel = {
  name:         { type: 'string',  required: true,  min: 1, max: 255 },
  channel_type: { type: 'string',  required: true },
  is_enabled:   { type: 'boolean', required: false },
};

const updateChannel = {
  name:         { type: 'string',  required: false, min: 1, max: 255 },
  channel_type: { type: 'string',  required: false },
  is_enabled:   { type: 'boolean', required: false },
};

module.exports = { createChannel, updateChannel };
