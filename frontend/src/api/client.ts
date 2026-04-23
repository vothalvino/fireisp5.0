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

// Token storage — access token lives in module scope (memory only, not localStorage).
// Refresh token lives in localStorage for cross-tab persistence.
let _accessToken: string | null = null;

export const tokenStore = {
  getAccess: () => _accessToken,
  setAccess: (token: string | null) => { _accessToken = token; },
  getRefresh: () => localStorage.getItem('fireisp_refresh_token'),
  setRefresh: (token: string | null) => {
    if (token) {
      localStorage.setItem('fireisp_refresh_token', token);
    } else {
      localStorage.removeItem('fireisp_refresh_token');
    }
  },
  clear: () => {
    _accessToken = null;
    localStorage.removeItem('fireisp_refresh_token');
  },
};

// Track in-flight refresh so concurrent 401s only fire one refresh request.
let _refreshPromise: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      tokenStore.clear();
      return false;
    }

    const json = (await res.json()) as {
      data: { accessToken: string; refreshToken: string };
    };

    tokenStore.setAccess(json.data.accessToken);
    tokenStore.setRefresh(json.data.refreshToken);
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
    return fetch(request, options as RequestInit);
  },
};

export const api = createClient<paths>({ baseUrl: '/api/v1' });
api.use(authMiddleware);
api.use(refreshMiddleware);
