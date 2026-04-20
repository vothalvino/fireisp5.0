// =============================================================================
// FireISP 5.0 — PrivateRoute
// =============================================================================
// Wraps protected routes:
//   • Redirects unauthenticated users to /login
//   • Renders <NotAllowed> when the user lacks the required role
//   • Shows a full-page spinner while auth state is initialising
// =============================================================================

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

// ---------------------------------------------------------------------------
// Role hierarchy — higher index = broader privilege
// ---------------------------------------------------------------------------
const ROLE_RANK: Record<string, number> = {
  'read-only': 1,
  support: 2,
  technician: 3,
  billing: 3,
  admin: 10,
};

export function hasRole(userRole: string, required: string): boolean {
  // admin always passes
  if (userRole === 'admin') return true;
  // exact match
  if (userRole === required) return true;
  // rank-based fallback
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[required] ?? 0);
}

// ---------------------------------------------------------------------------
// PrivateRoute
// ---------------------------------------------------------------------------

interface PrivateRouteProps {
  /** Minimum role required to access this route. Omit for any authenticated user. */
  requiredRole?: string;
}

export function PrivateRoute({ requiredRole }: PrivateRouteProps) {
  const { user, loading, initialized } = useAuth();
  const location = useLocation();

  // Show nothing (or a spinner) until auth is resolved on mount.
  if (loading || !initialized) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'sans-serif',
          color: '#555',
        }}
      >
        Loading…
      </div>
    );
  }

  // Not authenticated — send to login, preserving the intended destination.
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated but lacks the required role.
  if (requiredRole && !hasRole(user.role, requiredRole)) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'sans-serif',
          gap: 8,
        }}
      >
        <h2>403 — Not Allowed</h2>
        <p>You don't have permission to view this page.</p>
      </div>
    );
  }

  return <Outlet />;
}
