// =============================================================================
// FireISP 5.0 — Portal Auth Context
// =============================================================================
// Manages authentication state for the client self-service portal.
// Completely separate from the staff AuthContext — uses /portal/* endpoints
// and relies on httpOnly SameSite cookies for refresh-token storage.
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
// Token storage (access token in memory; refresh token stays in httpOnly cookie)
// ---------------------------------------------------------------------------

const PORTAL_REFRESH_KEY = 'fireisp_portal_refresh_token';

let _portalAccessToken: string | null = null;

export const portalTokenStore = {
  getAccess: () => _portalAccessToken,
  setAccess: (token: string | null) => { _portalAccessToken = token; },
  getRefresh: () => null,
  setRefresh: (token: string | null) => {
    if (!token) {
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

  const hydrateClient = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const res = await fetch('/api/v1/portal/auth/me', {
        credentials: 'include',
        headers: portalTokenStore.getAccess()
          ? { Authorization: `Bearer ${portalTokenStore.getAccess()}` }
          : {},
      });
      if (res.ok) {
        const json = (await res.json()) as { data: PortalClient };
        setState({ client: json.data, loading: false, initialized: true });
      } else {
        portalTokenStore.clear();
        setState({ client: null, loading: false, initialized: true });
      }
    } catch {
      portalTokenStore.clear();
      setState({ client: null, loading: false, initialized: true });
    }
  }, []);

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    (async () => {
      try {
        const res = await fetch('/api/v1/portal/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            data: { accessToken: string; refreshToken: string };
          };
          portalTokenStore.setAccess(json.data.accessToken);
          portalTokenStore.setRefresh(json.data.refreshToken);
          await hydrateClient();
        } else {
          portalTokenStore.clear();
          setState({ client: null, loading: false, initialized: true });
        }
      } catch {
        portalTokenStore.clear();
        setState({ client: null, loading: false, initialized: true });
      }
    })();
  }, [hydrateClient]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/v1/portal/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
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
    setState({ client: json.data.client, loading: false, initialized: true });
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/v1/portal/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
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
