// =============================================================================
// FireISP 5.0 — Device Group Validation Schemas
// =============================================================================

const createDeviceGroup = {
  name: { type: 'string', minLength: 1, maxLength: 200, required: true },
  description: { type: 'string', maxLength: 5000 },
  group_type: { type: 'string', enum: ['type', 'location', 'region', 'olt', 'custom'] },
  color: { type: 'string', maxLength: 7 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateDeviceGroup = { ...createDeviceGroup };
delete updateDeviceGroup.name;
updateDeviceGroup.name = { type: 'string', minLength: 1, maxLength: 200 };

const addGroupMembers = {
  device_ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 200, required: true },
};

module.exports = { createDeviceGroup, updateDeviceGroup, addGroupMembers };
