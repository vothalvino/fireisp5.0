// =============================================================================
// FireISP 5.0 — useOrgCurrency hook
// =============================================================================
// Returns the ISO 4217 currency code for the currently active organization.
// Falls back to 'MXN' when the active org is not found in the auth context
// (e.g. during initial load or unauthenticated pages).

import { useAuth } from './AuthContext';

/**
 * Return the currency of the active organization.
 * The active org is identified by `user.organization_id`; the org record
 * is looked up in `user.organizations[]` which is populated by GET /auth/me.
 */
export function useOrgCurrency(): string {
  const { user } = useAuth();
  if (!user) return 'MXN';

  const activeOrg = (user.organizations ?? []).find(
    (o) => o.id === user.organization_id,
  );

  // AuthOrganization now carries `currency` from the /auth/me response.
  return (activeOrg as { id: number; name: string; currency?: string })?.currency ?? 'MXN';
}
