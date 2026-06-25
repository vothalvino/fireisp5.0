// =============================================================================
// FireISP 5.0 — AuthContext tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from '../AuthContext';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function mockFetch(responses: Array<{ ok: boolean; json?: object; status?: number }>) {
  let callIndex = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 401),
      json: () => Promise.resolve(resp.json ?? {}),
    } as Response);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenStore.clear();
    localStorage.clear();
    // Clear the CSRF cookie between tests (cookie-first restore reads it).
    document.cookie = 'fireisp_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('settles logged-out when neither the access cookie nor refresh cookie is valid', async () => {
    // Cookie-first bootstrap: GET /auth/me (access cookie) → 401, then a single
    // POST /auth/refresh → 401 → settle as logged-out.
    mockFetch([
      { ok: false, status: 401, json: { error: { message: 'No session' } } }, // GET /auth/me
      { ok: false, status: 401, json: { error: { message: 'No session' } } }, // POST /auth/refresh
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('restores the session from the access cookie alone — no /refresh, no rotation', async () => {
    const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };
    const fetchSpy = mockFetch([
      // GET /auth/me → 200 via the httpOnly fireisp_access cookie
      { ok: true, json: { data: user } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current.user).toMatchObject({ id: 1, email: 'admin@test.com' });
    expect(result.current.loading).toBe(false);
    // A single GET — no /refresh round-trip, no refresh-token rotation. The cookie
    // carries auth for subsequent API calls, so no in-memory token is needed.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(tokenStore.getAccess()).toBeNull();
  });

  it('falls back to /refresh when the access cookie is expired, then hydrates', async () => {
    const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };
    mockFetch([
      { ok: false, status: 401 },                                                       // GET /auth/me → access cookie expired
      { ok: true, json: { data: { accessToken: 'access-1', refreshToken: 'refresh-2' } } }, // POST /auth/refresh → new token
      { ok: true, json: { data: user } },                                               // GET /auth/me (hydrate) → 200
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current.user).toMatchObject({ id: 1, email: 'admin@test.com' });
    expect(tokenStore.getAccess()).toBe('access-1');
    expect(localStorage.getItem('fireisp_refresh_token')).toBeNull();
  });

  it('does NOT bounce to login on a transient 429 during bootstrap — retries then restores', async () => {
    const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };
    mockFetch([
      { ok: false, status: 429 },         // GET /auth/me → rate-limited (transient)
      { ok: true, json: { data: user } }, // retry GET /auth/me → 200
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true), { timeout: 3000 });
    // A 429 must NOT dump an active session on the login screen.
    expect(result.current.user).toMatchObject({ id: 1 });
  });

  it('clears access token when both /me and /refresh fail on mount', async () => {
    mockFetch([
      { ok: false, status: 401 }, // GET /auth/me
      { ok: false, status: 401 }, // POST /auth/refresh
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.user).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
    expect(localStorage.getItem('fireisp_refresh_token')).toBeNull();
  });

  it('login() stores access token in memory and sets user; no localStorage refresh', async () => {
    const user = { id: 2, email: 'user@test.com', name: 'User', role: 'billing', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    mockFetch([
      { ok: false, status: 401 }, // mount GET /auth/me → 401
      { ok: false, status: 401 }, // mount POST /auth/refresh → 401 (no session yet)
      { ok: true, json: { data: { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900, user } } }, // POST /auth/login
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    await act(async () => {
      await result.current.login('user@test.com', 'secret');
    });

    expect(result.current.user).toMatchObject({ id: 2, email: 'user@test.com' });
    expect(tokenStore.getAccess()).toBe('acc');
    expect(localStorage.getItem('fireisp_refresh_token')).toBeNull();
  });

  it('login() throws on server error', async () => {
    mockFetch([
      { ok: false, status: 401 }, // mount GET /auth/me → 401
      { ok: false, status: 401 }, // mount POST /auth/refresh → 401
      { ok: false, status: 401, json: { error: { message: 'Invalid credentials' } } }, // POST /auth/login
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    await expect(
      act(async () => { await result.current.login('bad@test.com', 'wrong'); })
    ).rejects.toThrow('Invalid credentials');
  });

  it('logout() clears access token and user', async () => {
    const user = { id: 1, email: 'a@b.com', name: 'A', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    mockFetch([
      { ok: false, status: 401 }, // mount GET /auth/me → 401
      { ok: false, status: 401 }, // mount POST /auth/refresh → 401
      { ok: true, json: { data: { accessToken: 'a', refreshToken: 'r', expiresIn: 900, user } } }, // login
      { ok: true, json: {} }, // logout
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    await act(async () => { await result.current.login('a@b.com', 'pass'); });
    expect(result.current.user).not.toBeNull();

    await act(async () => { await result.current.logout(); });
    expect(result.current.user).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
  });

  // After a cookie-first reload the session is restored via the access cookie with
  // NO in-memory token. logout() and switchOrganization() must still work (cookie-auth
  // + CSRF), not no-op or throw "Not authenticated". Regression guards for the two
  // bugs the adversarial review caught in this change.
  describe('cookie-first session (no in-memory token)', () => {
    const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    it('logout() still calls the server (cookie-auth + CSRF) when there is no in-memory token', async () => {
      document.cookie = 'fireisp_csrf=csrf-tok; path=/';
      const fetchSpy = mockFetch([
        { ok: true, json: { data: user } }, // mount GET /auth/me → restored via access cookie
        { ok: true, json: {} },             // POST /auth/logout
      ]);

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.initialized).toBe(true));
      expect(tokenStore.getAccess()).toBeNull(); // restored via cookie — no token

      await act(async () => { await result.current.logout(); });

      const logoutCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/auth/logout'));
      expect(logoutCall).toBeDefined(); // server-side revocation actually happens
      const headers = (logoutCall![1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('csrf-tok');
      expect(headers.Authorization).toBeUndefined();
      expect(result.current.user).toBeNull();
    });

    it('switchOrganization() works via the access cookie without an in-memory token', async () => {
      document.cookie = 'fireisp_csrf=csrf-tok; path=/';
      const fetchSpy = mockFetch([
        { ok: true, json: { data: user } },                                                          // mount GET /auth/me
        { ok: true, json: { data: { accessToken: 'sw', refreshToken: 'r', organization: { id: 7 } } } }, // POST /switch-organization
        { ok: true, json: { data: { ...user, organization_id: 7 } } },                               // hydrateUser GET /auth/me
      ]);

      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.initialized).toBe(true));
      expect(tokenStore.getAccess()).toBeNull();

      // Must NOT throw "Not authenticated".
      await act(async () => { await result.current.switchOrganization(7); });

      const switchCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/switch-organization'));
      expect(switchCall).toBeDefined();
      const headers = (switchCall![1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('csrf-tok');
      expect(headers.Authorization).toBeUndefined();
    });
  });
});
