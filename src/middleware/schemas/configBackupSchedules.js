const createSchedule = {
  schedule_name: { type: 'string', required: true, min: 1, max: 255 },
  device_id: { type: 'number', min: 1 },
  cron_expression: { type: 'string', max: 50 },
  is_enabled: { type: 'boolean' },
};

const updateSchedule = {
  schedule_name: { type: 'string', min: 1, max: 255 },
  device_id: { type: 'number', min: 1 },
  cron_expression: { type: 'string', max: 50 },
  is_enabled: { type: 'boolean' },
};

module.exports = { createSchedule, updateSchedule };
