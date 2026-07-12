// =============================================================================
// FireISP 5.0 — Role Validation Schemas
// =============================================================================

const createRole = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  description: { type: 'string', max: 500 },
  // 'admin' is deliberately EXCLUDED from the allowed values here. An
  // admin-kind custom group would mirror to the legacy users.role === 'admin'
  // (see User.resolveGroupMirror), which rbac.js treats as a full RBAC
  // bypass — the group's own permission list would never be consulted. Only
  // the seeded system groups ('admin', 'super_admin') carry kind 'admin'
  // (migration 378 backfill); routes/roles.js enforces this again at the
  // route layer as defense in depth.
  kind: { type: 'string', required: true, enum: ['billing', 'support', 'technician', 'readonly'] },
};

const updateRole = {
  name: { type: 'string', min: 1, max: 100 },
  description: { type: 'string', max: 500 },
  // Same exclusion as createRole.kind above — see comment there.
  kind: { type: 'string', enum: ['billing', 'support', 'technician', 'readonly'] },
};

const assignPermission = {
  permission_id: { type: 'number', required: true, min: 1 },
};

// Bulk-replace a role's entire permission set (PUT /:id/permissions).
const setPermissions = {
  permission_ids: { type: 'array', required: true },
};

module.exports = { createRole, updateRole, assignPermission, setPermissions };
