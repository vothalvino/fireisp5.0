// =============================================================================
// FireISP 5.0 — Auth Context
// =============================================================================
// Manages:
//   • Login  — POST /auth/login → store access token in memory, refresh in localStorage
//   • Logout — POST /auth/logout → clear tokens
//   • me()   — GET /auth/me → hydrate user profile + roles on mount
//   • Silent refresh is handled transparently by the API client middleware
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;        // primary role slug, e.g. "admin" | "technician" | "billing" | "support"
  roles?: string[];    // all roles the user belongs to
  organization_id: number | null;
  is_active: boolean;
  email_verified: boolean;
  twofa_enabled: boolean;
  organizations?: AuthOrganization[];
}

export interface AuthOrganization {
  id: number;
  name: string;
  membership_role?: string;
}

interface AuthState {
  user: AuthUser | null;
  /** true while the initial /auth/me call is in flight */
  loading: boolean;
  /** true after the first /auth/me attempt completes (success or failure) */
  initialized: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Call after an external token change (e.g., impersonation) to re-hydrate user */
  refresh: () => Promise<void>;
  /** Switch the active organization for a multi-tenant user */
  switchOrganization: (organizationId: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    initialized: false,
  });

  // Fetch /auth/me with the current access token.
  const hydrateUser = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: tokenStore.getAccess()
          ? { Authorization: `Bearer ${tokenStore.getAccess()}` }
          : {},
        credentials: 'include',
      });
      if (res.ok) {
        const json = (await res.json()) as { data: AuthUser };
        setState({ user: json.data, loading: false, initialized: true });
      } else {
        tokenStore.clear();
        setState({ user: null, loading: false, initialized: true });
      }
    } catch {
      tokenStore.clear();
      setState({ user: null, loading: false, initialized: true });
    }
  }, []);

  // On mount: attempt silent session restore by calling the refresh endpoint.
  // The httpOnly `fireisp_refresh` cookie is sent automatically by the browser
  // (credentials: 'include'), so no localStorage read is needed.  If the
  // cookie is absent or expired the server returns 401 and we settle as
  // logged-out without further network calls.
  //
  // The CSRF middleware enforces X-CSRF-Token for cookie-authenticated POSTs.
  // Read the non-httpOnly `fireisp_csrf` cookie and echo it back.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    (async () => {
      try {
        const csrfMatch = document.cookie.match(/(?:^|;\s*)fireisp_csrf=([^;]*)/);
        const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          credentials: 'include',
        });
        if (res.ok) {
          const json = (await res.json()) as {
            data: { accessToken: string; refreshToken: string };
          };
          tokenStore.setAccess(json.data.accessToken);
          await hydrateUser();
        } else {
          tokenStore.clear();
          setState({ user: null, loading: false, initialized: true });
        }
      } catch {
        tokenStore.clear();
        setState({ user: null, loading: false, initialized: true });
      }
    })();
  }, [hydrateUser]);

  const login = useCallback(
    async (email: string, password: string, totpCode?: string) => {
      const body: Record<string, unknown> = { email, password };
      if (totpCode) body.totpCode = totpCode;

      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(err.error?.message ?? 'Login failed');
      }

      const json = (await res.json()) as { data: LoginResponse };
      // Access token kept in memory; refresh token is managed as an httpOnly
      // cookie by the server — no localStorage write needed.
      tokenStore.setAccess(json.data.accessToken);

      setState({ user: json.data.user, loading: false, initialized: true });
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      const accessToken = tokenStore.getAccess();
      if (accessToken) {
        // Send credentials so the httpOnly refresh cookie is included for
        // server-side session revocation.
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'include',
        });
      }
    } finally {
      tokenStore.clear();
      setState({ user: null, loading: false, initialized: true });
    }
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: number) => {
      const accessToken = tokenStore.getAccess();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      // The httpOnly refresh cookie is sent automatically via credentials:'include'.
      // No need to read it from localStorage or pass it in the request body.
      const res = await fetch('/api/v1/auth/switch-organization', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({ organizationId }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(err.error?.message ?? 'Failed to switch organization');
      }

      const json = (await res.json()) as {
        data: { accessToken: string; refreshToken: string };
      };
      // Server rotates the httpOnly refresh cookie in the response headers.
      tokenStore.setAccess(json.data.accessToken);

      // Re-hydrate user profile so `organization_id` and any org-scoped state
      // reflects the new context.
      await hydrateUser();
    },
    [hydrateUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, refresh: hydrateUser, switchOrganization }),
    [state, login, logout, hydrateUser, switchOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
