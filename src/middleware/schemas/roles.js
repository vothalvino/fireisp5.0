// =============================================================================
// FireISP 5.0 — Role Validation Schemas
// =============================================================================

const createRole = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  description: { type: 'string', max: 500 },
};

const updateRole = {
  name: { type: 'string', min: 1, max: 100 },
  description: { type: 'string', max: 500 },
};

const assignPermission = {
  permission_id: { type: 'number', required: true, min: 1 },
};

module.exports = { createRole, updateRole, assignPermission };
