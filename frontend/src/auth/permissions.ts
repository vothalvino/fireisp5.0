// =============================================================================
// FireISP 5.0 — Frontend permission helper
// =============================================================================
// The admin UI only receives the user's primary role (not the full permission
// set), so this map mirrors the backend role_permissions seed
// (database/schema.sql) for the write actions exposed in the frontdesk.
//
// It is a UX guard only — the API still enforces requirePermission(...) on
// every mutating route — but it prevents showing action buttons that would
// inevitably 403 for the current role.
// =============================================================================

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],
  support: ['clients.create', 'clients.update'],
  technician: ['devices.create', 'devices.update', 'devices.delete'],
  billing: [],
  'read-only': [],
  readonly: [],
};

/**
 * Check whether the given role may perform the given permission.
 * Admin always passes; unknown roles never pass.
 */
export function can(role: string | undefined | null, permission: string): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes('*') || perms.includes(permission);
}
