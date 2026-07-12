// =============================================================================
// FireISP 5.0 — User Validation Schemas
// =============================================================================

const createUser = {
  first_name: { type: 'string', required: true, min: 1, max: 100 },
  last_name: { type: 'string', required: true, min: 1, max: 100 },
  email: { type: 'email', required: true },
  password: { type: 'string', required: true, min: 8, max: 128 },
  // Legacy "user type" — kept as a synced mirror of the group's kind (378).
  role: { type: 'string', enum: ['admin', 'billing', 'support', 'technician', 'readonly'] },
  // The user group (roles.id) whose permission set governs this staff account.
  group_id: { type: 'number' },
  // Organizations this staff account may access (organization_users sync).
  organization_ids: { type: 'array' },
  phone: { type: 'string', max: 30 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateUser = {
  first_name: { type: 'string', min: 1, max: 100 },
  last_name: { type: 'string', min: 1, max: 100 },
  email: { type: 'email' },
  password: { type: 'string', min: 8, max: 128 },
  role: { type: 'string', enum: ['admin', 'billing', 'support', 'technician', 'readonly'] },
  group_id: { type: 'number' },
  organization_ids: { type: 'array' },
  phone: { type: 'string', max: 30 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const patchUser = Object.fromEntries(
  Object.entries(updateUser).map(([k, v]) => [k, { ...v, required: false }]),
);

// PATCH /users/:id/group — reassign an ARCHIVED user's group without restoring.
const setArchivedGroup = {
  group_id: { type: 'number', required: true },
};

module.exports = { createUser, updateUser, patchUser, setArchivedGroup };
