// =============================================================================
// FireISP 5.0 — useOrgCurrency hook
// =============================================================================
// Returns the ISO 4217 currency code for the currently active organization.
// Falls back to 'MXN' when the active org is not found in the auth context
// (e.g. during initial load or unauthenticated pages).

import { useAuth } from './AuthContext';

/**
 * Return the currency of the active organization.
 * Prefers `user.organization_currency` (resolved server-side in GET /auth/me for
 * the active org — correct even for an org the user is not a member of, e.g. a
 * super-admin who switched tenants). Falls back to looking the active org up in
 * `user.organizations[]` (memberships), then to 'MXN'.
 */
export function useOrgCurrency(): string {
  const { user } = useAuth();
  if (!user) return 'MXN';

  if (user.organization_currency) return user.organization_currency;

  const activeOrg = (user.organizations ?? []).find((o) => o.id === user.organization_id);
  return activeOrg?.currency ?? 'MXN';
}
