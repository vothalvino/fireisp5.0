// =============================================================================
// FireISP 5.0 — Typed API client
// =============================================================================
// Built on openapi-fetch, which uses the generated schema.d.ts to give full
// end-to-end TypeScript coverage from the OpenAPI spec.
//
// Usage:
//   import { api } from '@/api/client';
//   const { data, error } = await api.GET('/clients', { params: { query: { page: 1 } } });
// =============================================================================

import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import { readCsrfCookie } from './csrf';

// Access token lives in module scope (memory only).  The refresh token is now
// stored as an httpOnly SameSite=Strict cookie set by the server, so it is no
// longer readable or writable from JavaScript — which eliminates the
// XSS-token-theft attack class on long-lived refresh tokens.
let _accessToken: string | null = null;

export const tokenStore = {
  getAccess: () => _accessToken,
  setAccess: (token: string | null) => { _accessToken = token; },
  // Refresh token lives exclusively in httpOnly cookie — these are no-ops kept
  // for backward compatibility with test code that calls tokenStore.clear().
  getRefresh: () => null,
  setRefresh: (_token: string | null) => { /* managed by server cookie */ },
  clear: () => { _accessToken = null; },
};

// Track in-flight refresh so concurrent 401s only fire one refresh request.
let _refreshPromise: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    // No body needed — the browser sends the httpOnly `fireisp_refresh` cookie
    // automatically.  `credentials: 'include'` is required for same-origin
    // cookie delivery on fetch calls.
    //
    // The CSRF middleware enforces X-CSRF-Token for cookie-authenticated POSTs.
    // Read the non-httpOnly `fireisp_csrf` cookie and echo it back as the header.
    const csrfToken = readCsrfCookie();
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      credentials: 'include',
    });

    if (!res.ok) {
      tokenStore.clear();
      return false;
    }

    const json = (await res.json()) as {
      data: { accessToken: string; refreshToken: string };
    };

    // Keep the new access token in memory for the Authorization header path
    // (used by API clients and programmatic test code).  The server has already
    // rotated the httpOnly refresh cookie in its Set-Cookie response header.
    tokenStore.setAccess(json.data.accessToken);
    return true;
  } catch {
    tokenStore.clear();
    return false;
  }
}

// Middleware: attach Authorization header to every request.
const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = tokenStore.getAccess();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    // Right after a reload the in-memory token is gone; the request authenticates
    // via the httpOnly `fireisp_access` cookie instead (createClient sends it with
    // credentials:'include'). That makes state-changing requests cookie-authenticated,
    // which the server's CSRF guard requires the `fireisp_csrf` token for. Bearer
    // requests are CSRF-exempt and ignore it, so sending it always is safe.
    const csrf = readCsrfCookie();
    if (csrf) {
      request.headers.set('X-CSRF-Token', csrf);
    }
    return request;
  },
};

// Middleware: on 401, attempt a single silent refresh then retry.
const refreshMiddleware: Middleware = {
  async onResponse({ request, response, options }) {
    if (response.status !== 401) return response;

    // Deduplicate concurrent refresh attempts.
    if (!_refreshPromise) {
      _refreshPromise = doRefresh().finally(() => { _refreshPromise = null; });
    }
    const ok = await _refreshPromise;
    if (!ok) return response; // caller sees 401 — AuthContext will logout

    // Retry original request with new token.
    const token = tokenStore.getAccess();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(request, { ...(options as RequestInit), credentials: 'include' });
  },
};

// credentials:'include' sends the httpOnly auth cookies, so a reload within the
// access-token lifetime authenticates via the `fireisp_access` cookie alone — no
// `/refresh` round-trip and no refresh-token rotation on every page load.
export const api = createClient<paths>({ baseUrl: '/api/v1', credentials: 'include' });
api.use(authMiddleware);
api.use(refreshMiddleware);

// Authenticated fetch with the SAME attach-token + silent-refresh-on-401 + retry
// behaviour as the REST middleware above, for callers that don't go through
// openapi-fetch (e.g. the GraphQL client). The access token lives in memory only
// and is wiped on every page reload, so without this a GraphQL request after a
// reload (or after the access-token lifetime) would 401 forever and surface as
// "Client not found"; here a 401 triggers a single shared refresh (via the
// httpOnly cookie) and one retry, mirroring refreshMiddleware.
export async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const build = (): RequestInit => {
    const headers = new Headers(init?.headers);
    const token = tokenStore.getAccess();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // When the in-memory Bearer token is absent (e.g. right after a page reload),
    // the request authenticates via the httpOnly `fireisp_access` cookie instead —
    // which makes this a cookie-authenticated POST that the server's CSRF guard
    // rejects (403) unless we echo the `fireisp_csrf` cookie as a header. Bearer-
    // authenticated requests are CSRF-exempt and ignore it, so sending it always
    // is safe. Without this, GraphQL detail pages 403'd as "Client not found".
    const csrf = readCsrfCookie();
    if (csrf) headers.set('X-CSRF-Token', csrf);
    return { ...init, headers, credentials: 'include' };
  };

  let res = await fetch(input, build());
  if (res.status === 401) {
    if (!_refreshPromise) {
      _refreshPromise = doRefresh().finally(() => { _refreshPromise = null; });
    }
    const ok = await _refreshPromise;
    if (ok) res = await fetch(input, build());
  }
  return res;
}
