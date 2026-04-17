// =============================================================================
// FireISP 5.0 — User Validation Schemas
// =============================================================================

const createUser = {
  first_name: { type: 'string', required: true, min: 1, max: 100 },
  last_name: { type: 'string', required: true, min: 1, max: 100 },
  email: { type: 'email', required: true },
  password: { type: 'string', required: true, min: 8, max: 128 },
  role: { type: 'string', enum: ['admin', 'billing', 'support', 'technician'] },
  phone: { type: 'string', max: 30 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateUser = {
  first_name: { type: 'string', min: 1, max: 100 },
  last_name: { type: 'string', min: 1, max: 100 },
  email: { type: 'email' },
  password: { type: 'string', min: 8, max: 128 },
  role: { type: 'string', enum: ['admin', 'billing', 'support', 'technician'] },
  phone: { type: 'string', max: 30 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const patchUser = { ...updateUser };

module.exports = { createUser, updateUser, patchUser };
