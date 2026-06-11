'use strict';

const createChain = {
  name:        { type: 'string', required: true,  min: 1, max: 255 },
  description: { type: 'string', required: false },
};

const updateChain = {
  name:        { type: 'string', required: false, min: 1, max: 255 },
  description: { type: 'string', required: false },
};

const createStep = {
  step_number:          { type: 'number', required: true },
  delay_minutes:        { type: 'number', required: false },
  notification_channel: { type: 'string', required: true },
  recipient_email:      { type: 'string', required: false },
  recipient_phone:      { type: 'string', required: false },
  webhook_url:          { type: 'string', required: false },
  message_template:     { type: 'string', required: false },
};

module.exports = { createChain, updateChain, createStep };
