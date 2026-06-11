const createTemplate = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  device_type: { type: 'string', max: 50 },
  manufacturer: { type: 'string', max: 100 },
  template_content: { type: 'string', required: true, min: 1 },
  variables_schema: { type: 'any' },
  status: { type: 'string', enum: ['active', 'inactive', 'draft'] },
};

const updateTemplate = {
  name: { type: 'string', min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  device_type: { type: 'string', max: 50 },
  manufacturer: { type: 'string', max: 100 },
  template_content: { type: 'string', min: 1 },
  variables_schema: { type: 'any' },
  status: { type: 'string', enum: ['active', 'inactive', 'draft'] },
};

module.exports = { createTemplate, updateTemplate };
