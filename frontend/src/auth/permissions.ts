// =============================================================================
// FireISP 5.0 — Frontend permission helper
// =============================================================================
// /auth/me and /auth/login resolve the ACTIVE org's real permission set
// server-side (migration 378 — user groups) and return it as `permissions`
// on the auth user, alongside the legacy `role` mirror. This helper prefers
// that authoritative list and only falls back to the hardcoded role map for
// users hydrated from an older backend response (or mid-migration) that
// doesn't carry `permissions` yet.
//
// It is a UX guard only — the API still enforces requirePermission(...) on
// every mutating route — but it prevents showing action buttons that would
// inevitably 403 for the current role.
// =============================================================================

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],
  support: [
    'clients.create', 'clients.update',
    'tickets.view', 'tickets.create', 'tickets.update', 'tickets.delete',
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
    // Invoicing + payments (mirrors the backend billing role seed — migration 119)
    'invoices.view', 'invoices.create', 'invoices.update', 'invoices.delete',
    'payments.view', 'payments.create', 'payments.update', 'payments.delete',
    'winback.view', 'winback.create', 'winback.update', 'winback.delete',
    'lifecycle.view',
    'suspension_rules.create', 'suspension_rules.update', 'suspension_rules.delete',
    'interactions.view', 'follow_ups.view', 'surveys.view',
    'campaigns.view', 'campaigns.create', 'campaigns.update', 'campaigns.delete',
    'dnd.view', 'dnd.update',
  ],
  readonly: ['winback.view', 'lifecycle.view', 'interactions.view', 'follow_ups.view', 'surveys.view', 'escalations.view', 'campaigns.view', 'dnd.view', 'nas.health'],
};

/** The minimal shape `can()` needs from the auth user — kept separate from
 *  `AuthUser` so this module has no import-time dependency on AuthContext. */
export interface PermissionSubject {
  role?: string;
  permissions?: string[];
}

/**
 * Check whether the given user may perform the given permission.
 *
 * - No user → deny. There's nothing to check permissions against.
 * - `role === 'admin'` → always allow. Mirrors the backend RBAC bypass in
 *   `src/middleware/rbac.js`, where legacy `users.role='admin'` short-circuits
 *   every permission check regardless of the resolved permission set.
 * - `permissions` is an array → authoritative, and used as-is. This is the
 *   real, server-resolved set for the user's active org (custom groups
 *   included), so an empty array is a genuine DENY-all, not "unknown, fall
 *   through to the legacy map."
 * - Otherwise → fall back to the hardcoded `ROLE_PERMISSIONS` map keyed by
 *   `role`. This only fires for a user object hydrated before `permissions`
 *   existed on the response (older cached session, older backend), so it's
 *   a compatibility shim, not the primary path.
 */
export function can(user: PermissionSubject | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission);
  const perms = user.role ? ROLE_PERMISSIONS[user.role] : undefined;
  if (!perms) return false;
  return perms.includes('*') || perms.includes(permission);
}
