// =============================================================================
// FireISP 5.0 — Portal Auth Context
// =============================================================================
// Manages authentication state for the client self-service portal.
// Completely separate from the staff AuthContext — uses /portal/* endpoints
// and stores the portal refresh token in localStorage under a distinct key.
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

// ---------------------------------------------------------------------------
// Token storage (portal-specific localStorage key)
// ---------------------------------------------------------------------------

const PORTAL_REFRESH_KEY = 'fireisp_portal_refresh_token';

let _portalAccessToken: string | null = null;

export const portalTokenStore = {
  getAccess: () => _portalAccessToken,
  setAccess: (token: string | null) => { _portalAccessToken = token; },
  getRefresh: () => localStorage.getItem(PORTAL_REFRESH_KEY),
  setRefresh: (token: string | null) => {
    if (token) {
      localStorage.setItem(PORTAL_REFRESH_KEY, token);
    } else {
      localStorage.removeItem(PORTAL_REFRESH_KEY);
    }
  },
  clear: () => {
    _portalAccessToken = null;
    localStorage.removeItem(PORTAL_REFRESH_KEY);
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortalClient {
  id: number;
  name: string;
  email: string | null;
  organization_id: number | null;
}

interface PortalAuthState {
  client: PortalClient | null;
  loading: boolean;
  initialized: boolean;
}

interface PortalAuthContextValue extends PortalAuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PortalAuthContext = createContext<PortalAuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PortalAuthState>({
    client: null,
    loading: true,
    initialized: false,
  });

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    const refreshToken = portalTokenStore.getRefresh();
    if (!refreshToken) {
      setState({ client: null, loading: false, initialized: true });
      return;
    }

    // Restore the portal session on mount. The access token lives in memory and is
    // wiped on reload, so we re-exchange the (localStorage) refresh token, then load
    // the client profile. A 429 (rate-limited) or 5xx/network blip is transient — we
    // retry briefly rather than clearing the session, so a flaky or frequently-reloaded
    // portal session is not bounced to the login screen. Only a definitive 401/403 (or
    // a missing refresh token, handled above) settles as logged-out.
    const isTransient = (status: number) => status === 429 || status >= 500;
    const backoff = (n: number) => new Promise((resolve) => setTimeout(resolve, 400 * (n + 1)));
    const settleLoggedOut = () => {
      portalTokenStore.clear();
      setState({ client: null, loading: false, initialized: true });
    };

    (async () => {
      // Phase 1 — exchange the refresh token for a fresh access token.
      let accessToken: string | null = null;
      for (let attempt = 0; attempt < 3 && !accessToken; attempt++) {
        try {
          const res = await fetch('/api/v1/portal/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: portalTokenStore.getRefresh() }),
          });
          if (res.ok) {
            const json = (await res.json()) as { data: { accessToken: string; refreshToken: string } };
            portalTokenStore.setAccess(json.data.accessToken);
            portalTokenStore.setRefresh(json.data.refreshToken);
            accessToken = json.data.accessToken;
            break;
          }
          if (!isTransient(res.status)) { settleLoggedOut(); return; }
        } catch {
          // network error → transient, retry
        }
        await backoff(attempt);
      }
      if (!accessToken) { settleLoggedOut(); return; } // exhausted transient retries

      // Phase 2 — load the client profile (retry transient /me failures WITHOUT
      // re-refreshing, since the refresh token was already rotated above).
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch('/api/v1/portal/auth/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (res.ok) {
            const json = (await res.json()) as { data: PortalClient };
            setState({ client: json.data, loading: false, initialized: true });
            return;
          }
          if (!isTransient(res.status)) { settleLoggedOut(); return; }
        } catch {
          // network error → transient, retry
        }
        await backoff(attempt);
      }
      settleLoggedOut();
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/v1/portal/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? 'Login failed');
    }
    const json = (await res.json()) as {
      data: { accessToken: string; refreshToken: string; client: PortalClient };
    };
    portalTokenStore.setAccess(json.data.accessToken);
    portalTokenStore.setRefresh(json.data.refreshToken);
    setState({ client: json.data.client, loading: false, initialized: true });
  }, []);

  const logout = useCallback(async () => {
    try {
      const refreshToken = portalTokenStore.getRefresh();
      if (refreshToken) {
        await fetch('/api/v1/portal/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      }
    } finally {
      portalTokenStore.clear();
      setState({ client: null, loading: false, initialized: true });
    }
  }, []);

  const value = useMemo<PortalAuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  );

  return (
    <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePortalAuth(): PortalAuthContextValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used inside <PortalAuthProvider>');
  return ctx;
}
