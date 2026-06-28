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
  support: [
    'clients.create', 'clients.update',
    'leads.create', 'leads.update',
    'service_orders.create', 'service_orders.update',
    'winback.view', 'lifecycle.view',
    'interactions.view', 'interactions.create', 'interactions.update', 'interactions.delete',
    'follow_ups.view', 'follow_ups.create', 'follow_ups.update', 'follow_ups.delete',
    'surveys.view', 'surveys.create', 'surveys.update',
    'escalations.view', 'escalations.create', 'escalations.update',
    'campaigns.view', 'campaigns.create', 'campaigns.update',
    'dnd.view', 'dnd.update',
  ],
  technician: [
    'devices.create', 'devices.update', 'devices.delete', 'service_orders.update',
    'nas.health',
    'interactions.view', 'follow_ups.view', 'follow_ups.update', 'escalations.view',
    'campaigns.view', 'dnd.view',
  ],
  billing: [
    // Invoicing (mirrors the backend billing role seed — migration 119)
    'invoices.view', 'invoices.create', 'invoices.update', 'invoices.delete',
    'winback.view', 'winback.create', 'winback.update', 'winback.delete',
    'lifecycle.view',
    'suspension_rules.create', 'suspension_rules.update', 'suspension_rules.delete',
    'interactions.view', 'follow_ups.view', 'surveys.view',
    'campaigns.view', 'campaigns.create', 'campaigns.update', 'campaigns.delete',
    'dnd.view', 'dnd.update',
  ],
  'read-only': ['winback.view', 'lifecycle.view', 'interactions.view', 'follow_ups.view', 'surveys.view', 'escalations.view', 'campaigns.view', 'dnd.view', 'nas.health'],
  readonly: ['winback.view', 'lifecycle.view', 'interactions.view', 'follow_ups.view', 'surveys.view', 'escalations.view', 'campaigns.view', 'dnd.view', 'nas.health'],
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
