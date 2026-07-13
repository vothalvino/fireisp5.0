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
import { readCsrfCookie } from '@/api/csrf';
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
  /** Currency of the ACTIVE org, resolved server-side (works even for an org the
   *  user is not a member of, e.g. a super-admin switched into another tenant). */
  organization_currency?: string;
  /** Compliance locale of the ACTIVE org — 'MX' unlocks the SAT/IFT nav modules. */
  organization_locale?: 'global' | 'MX';
  /** The user's group (migration 378): reusable permission set replacing the
   *  fixed user type. `kind` is the persona the group is based on and matches
   *  what `role` mirrors. */
  group?: { id: number; name: string; kind: string | null } | null;
  /** Resolved permission slugs for the ACTIVE org — drives can() so custom
   *  groups reflect accurately in action buttons. */
  permissions?: string[];
  is_active: boolean;
  /** Null until the user clicks the link in their verification email.
   *  Informational only today — nothing gates login or feature access on it. */
  email_verified_at: string | null;
  twofa_enabled: boolean;
  organizations?: AuthOrganization[];
}

export interface AuthOrganization {
  id: number;
  name: string;
  currency?: string;
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
  /** Call after an external token change (e.g., impersonation) to re-hydrate user.
   *  Resolves true when the profile was refreshed, false on failure. */
  refresh: () => Promise<boolean>;
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
  // Returns true when the profile was (re-)hydrated, false otherwise — callers
  // that NEED fresh data (e.g. after an org switch) use this to retry.
  const hydrateUser = useCallback(async (): Promise<boolean> => {
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
        return true;
      }
      if (res.status === 401 || res.status === 403) {
        tokenStore.clear();
        setState({ user: null, loading: false, initialized: true });
        return false;
      }
      // Transient (429/5xx): the session is not dead, we just couldn't
      // re-hydrate right now — keep the current user instead of logging out.
      setState(s => ({ ...s, loading: false, initialized: true }));
      return false;
    } catch {
      // Network blip — same as transient above: keep the session.
      setState(s => ({ ...s, loading: false, initialized: true }));
      return false;
    }
  }, []);

  // Mid-session dead-session signal: doRefresh (api/client.ts) dispatches
  // this after a definitive double-401 on /auth/refresh. Without it nothing
  // ever sets user=null mid-session, so the user would sit in a rendered app
  // where every API call 401s until they manually reloaded.
  useEffect(() => {
    const onSessionExpired = () => {
      tokenStore.clear();
      setState({ user: null, loading: false, initialized: true });
    };
    window.addEventListener('fireisp:session-expired', onSessionExpired);
    return () => window.removeEventListener('fireisp:session-expired', onSessionExpired);
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

    // Restore the session on mount WITHOUT bouncing to /login on a transient hiccup.
    //
    // Cookie-first: the httpOnly `fireisp_access` cookie authenticates GET /auth/me
    // directly, so a reload within the access-token lifetime needs no /refresh (no
    // token rotation, a single request). Only when that cookie is missing/expired
    // (401) do we fall back to one /refresh and re-hydrate.
    //
    // A 429 (rate-limited) or 5xx/network blip means "couldn't verify right now",
    // NOT "logged out" — we retry briefly instead of clearing the session, so a
    // rate-limited or flaky reload never dumps the user on the login screen. Only a
    // definitive 401/403 settles as logged-out.
    const isTransient = (status: number) => status === 429 || status >= 500;
    const settleLoggedOut = () => {
      tokenStore.clear();
      setState({ user: null, loading: false, initialized: true });
    };
    // When rate-limited, the server says how long to wait — waiting a fixed
    // 400ms against a multi-minute window guaranteed a bounce to /login.
    const retryAfterMs = (res: Response): number | null => {
      const raw = typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : null;
      const seconds = Number(raw);
      return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
    };

    (async () => {
      // Refresh tokens are one-shot: if another tab redeemed the same cookie a
      // moment before us (parallel mount race), our /refresh 401s — but the
      // winner's rotated cookies are already in the browser jar, so ONE more
      // loop recovers the session via them. Only a second denial is real.
      let refreshDenied = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        // Default backoff for 5xx/network; a 429 overrides it below with the
        // server's Retry-After (much larger cap — waiting out a rate-limit
        // window beats bouncing a valid session to the login screen, which is
        // the exact defect this flow exists to prevent).
        let wait = Math.min(400 * (attempt + 1), 8000);
        try {
          // 1. Fetch /auth/me — via the Bearer token if we minted one this loop,
          //    otherwise via the httpOnly access cookie.
          const bearer = tokenStore.getAccess();
          const meRes = await fetch('/api/v1/auth/me', {
            headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
            credentials: 'include',
          });
          if (meRes.ok) {
            const json = (await meRes.json()) as { data: AuthUser };
            setState({ user: json.data, loading: false, initialized: true });
            return;
          }
          if (meRes.status === 401 || meRes.status === 403) {
            // 2. Access cookie missing/expired → one refresh, then loop to re-/me.
            const csrfToken = readCsrfCookie();
            const refreshRes = await fetch('/api/v1/auth/refresh', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
              },
              credentials: 'include',
            });
            if (refreshRes.ok) {
              const json = (await refreshRes.json()) as { data: { accessToken: string } };
              tokenStore.setAccess(json.data.accessToken);
              // Re-run the loop to fetch /me with the fresh token (no backoff), so a
              // 429/5xx on the post-refresh /me retries instead of logging out.
              continue;
            }
            if (refreshRes.status === 401 || refreshRes.status === 403) {
              // Denied — either truly logged out, or we lost the rotation race
              // to a sibling tab. Allow one full re-loop (see refreshDenied).
              if (refreshDenied) {
                settleLoggedOut();
                return;
              }
              refreshDenied = true;
            } else if (refreshRes.status === 429) {
              // Trust an explicit Retry-After (up to 30s per wait — riding out
              // a rate-limit window beats bouncing a valid session to /login);
              // without the header keep the default escalating backoff.
              const hint = retryAfterMs(refreshRes);
              if (hint !== null) wait = Math.min(hint, 30000);
            } else if (!isTransient(refreshRes.status)) {
              settleLoggedOut();
              return;
            }
          } else if (meRes.status === 429) {
            const hint = retryAfterMs(meRes);
            if (hint !== null) wait = Math.min(hint, 30000);
          } else if (!isTransient(meRes.status)) {
            settleLoggedOut();
            return;
          }
          // Transient on /me or /refresh → fall through to back off and retry.
        } catch {
          // Network error → transient, retry.
        }
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      // Exhausted retries against transient errors. We can't render the app without a
      // user, so settle logged-out as a last resort — but only after retrying, so a
      // single blip never hard-bounces an active session to login.
      settleLoggedOut();
    })();
  }, []);

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
      // ALWAYS hit the server so it revokes the refresh-token family and clears the
      // httpOnly cookies. After a cookie-first reload there is no in-memory token, so
      // a token-gated logout would be a no-op — the cookies would stay live and the
      // next reload would silently re-authenticate. /logout is authenticate-gated
      // (accepts the fireisp_access cookie) and is a cookie-auth POST, so send the
      // CSRF token; Bearer is added only when an in-memory token is present.
      const accessToken = tokenStore.getAccess();
      const csrf = readCsrfCookie();
      const post = () => fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        credentials: 'include',
      });
      const res = await post();
      // A failed logout (429/5xx) means the server did NOT revoke the refresh
      // token or clear the httpOnly cookies — on a shared computer the next
      // visitor would silently resume this session. One retry is cheap; if it
      // fails too we still clear local state (the user asked to log out), and
      // the residual risk is bounded by the refresh token's expiry.
      if (!res.ok) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await post();
      }
    } catch {
      // Ignore network errors — local state is cleared regardless below.
    } finally {
      tokenStore.clear();
      setState({ user: null, loading: false, initialized: true });
    }
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: number) => {
      // After a cookie-first reload the in-memory token may be empty; the httpOnly
      // fireisp_access cookie authenticates the request instead (so do NOT hard-gate
      // on a Bearer token — that regressed the switcher into "Not authenticated").
      // switch-organization is a cookie-auth state-changing POST, so it needs the
      // CSRF token (Bearer requests ignore it). The httpOnly fireisp_refresh cookie
      // (Path=/api/v1/auth) is attached automatically via credentials:'include'.
      const accessToken = tokenStore.getAccess();
      const csrf = readCsrfCookie();
      const res = await fetch('/api/v1/auth/switch-organization', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
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
        data: { accessToken: string; refreshToken: string; organization?: { id: number } };
      };
      // Server rotates the httpOnly refresh cookie in the response headers.
      tokenStore.setAccess(json.data.accessToken);

      // Re-hydrate the user profile so `organization_id` and org-scoped state
      // reflect the new context. hydrateUser tolerates transient failures by
      // KEEPING the previous user — which right after an org switch would
      // leave the whole UI (switcher, currency) on org A while every API call
      // runs against org B. Retry briefly; as a last resort patch the active
      // org locally so the UI tracks reality (currency etc. self-heal on the
      // next successful /me).
      for (let i = 0; i < 3; i++) {
        if (await hydrateUser()) return;
        await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)));
      }
      const switchedOrgId = json.data.organization?.id ?? organizationId;
      setState(s => (s.user ? { ...s, user: { ...s.user, organization_id: switchedOrgId } } : s));
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
