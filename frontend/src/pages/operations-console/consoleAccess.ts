// =============================================================================
// FireISP Operations Console — route-aware access helpers
// =============================================================================
// Dashboard deep links must follow the same visibility contract as the sidebar,
// hubs, and command palette. Keeping the lookup here prevents a KPI from looking
// interactive when its destination would immediately render NotAllowed.
// =============================================================================

import { ROUTES, canSee, type NavUser } from '@/nav/routes';

/** Whether the current user may open a registered dashboard destination. */
export function canOpenConsoleRoute(
  user: NavUser | null | undefined,
  destination: string,
): boolean {
  if (!user) return false;
  const pathname = destination.split(/[?#]/, 1)[0];
  const route = ROUTES.find((candidate) => candidate.path === pathname);
  return Boolean(route && canSee(user, route));
}
