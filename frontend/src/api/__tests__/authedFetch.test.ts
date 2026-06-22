// =============================================================================
// FireISP 5.0 — authedFetch regression tests
// =============================================================================
// Guards the ClientDetail-breaking bug: the access token lives in memory only
// and is wiped on every page reload. The REST client silently refreshes on 401
// and retries, but the GraphQL client (gql) did NOT — so every client(id) query
// after a reload (or after the 15-min token expiry) 401'd and surfaced as
// "Client not found" for ALL clients. graphql.ts now routes through authedFetch,
// which shares the attach-token + refresh-on-401 + retry behaviour.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authedFetch, tokenStore } from '@/api/client';

describe('authedFetch', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  it('attaches the bearer token and sends credentials when a token is present', async () => {
    tokenStore.setAccess('tok-1');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authedFetch('/api/v1/graphql', { method: 'POST' });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-1');
    expect(init.credentials).toBe('include');
  });

  it('sends X-CSRF-Token from the fireisp_csrf cookie (cookie-authed POSTs need it or the server 403s)', async () => {
    // No in-memory Bearer token (post-reload): the request authenticates via the
    // httpOnly fireisp_access cookie, so it MUST carry the CSRF header.
    document.cookie = 'fireisp_csrf=csrf-abc';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authedFetch('/api/v1/graphql', { method: 'POST' });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBeNull(); // no Bearer
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-abc');
    expect(init.credentials).toBe('include');
    // cleanup so the cookie doesn't leak into other tests
    document.cookie = 'fireisp_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('refreshes once on 401 and retries — recovers an empty in-memory token (post-reload)', async () => {
    const attempts: (string | null)[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/auth/refresh')) {
        // Server validates the httpOnly cookie and returns a fresh access token.
        tokenStore.setAccess('fresh-token');
        return new Response(JSON.stringify({ data: { accessToken: 'fresh-token', refreshToken: 'r' } }), { status: 200 });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      attempts.push(auth);
      return new Response('{}', { status: auth === 'Bearer fresh-token' ? 200 : 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    // No token in memory (as right after a page reload).
    const res = await authedFetch('/api/v1/graphql', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(attempts[0]).toBeNull();                 // first try: no token -> 401
    expect(attempts[1]).toBe('Bearer fresh-token'); // retried with refreshed token
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/auth/refresh'))).toBe(true);
  });

  it('returns the 401 (does not loop) when refresh fails', async () => {
    // Both the target request and /auth/refresh return 401.
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('/api/v1/graphql', { method: 'POST' });

    expect(res.status).toBe(401);
  });
});
