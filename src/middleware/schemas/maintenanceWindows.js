'use strict';

const createWindow = {
  name:                        { type: 'string',  required: true,  min: 1, max: 255 },
  description:                 { type: 'string',  required: false },
  device_id:                   { type: 'number',  required: false },
  site_id:                     { type: 'number',  required: false },
  starts_at:                   { type: 'string',  required: true },
  ends_at:                     { type: 'string',  required: true },
  is_recurring:                { type: 'boolean', required: false },
  recurrence_cron:             { type: 'string',  required: false },
  recurrence_duration_minutes: { type: 'number',  required: false },
};

const updateWindow = {
  name:                        { type: 'string',  required: false, min: 1, max: 255 },
  description:                 { type: 'string',  required: false },
  device_id:                   { type: 'number',  required: false },
  site_id:                     { type: 'number',  required: false },
  starts_at:                   { type: 'string',  required: false },
  ends_at:                     { type: 'string',  required: false },
  is_recurring:                { type: 'boolean', required: false },
  recurrence_cron:             { type: 'string',  required: false },
  recurrence_duration_minutes: { type: 'number',  required: false },
  status:                      { type: 'string',  required: false },
};

module.exports = { createWindow, updateWindow };
