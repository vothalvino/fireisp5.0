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
  });

  it('initialises and settles with no user when the server has no valid cookie', async () => {
    // On mount AuthContext always attempts a refresh call (no localStorage check).
    // When the server returns 401 (no cookie / expired), we settle as logged-out.
    mockFetch([
      // POST /auth/refresh → 401 (no valid cookie on server side)
      { ok: false, status: 401, json: { error: { message: 'No session' } } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('restores session silently when a valid refresh cookie exists on the server', async () => {
    // The browser automatically sends the httpOnly cookie — we just need the
    // server (mocked here) to return a new token pair.
    const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    mockFetch([
      // POST /auth/refresh → success (server reads cookie, issues new tokens)
      { ok: true, json: { data: { accessToken: 'access-1', refreshToken: 'refresh-2' } } },
      // GET /auth/me → success
      { ok: true, json: { data: user } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current.user).toMatchObject({ id: 1, email: 'admin@test.com' });
    expect(result.current.loading).toBe(false);
    // Access token stored in memory for Authorization header path
    expect(tokenStore.getAccess()).toBe('access-1');
    // Refresh token is no longer written to localStorage — it lives in the
    // httpOnly cookie managed by the server
    expect(localStorage.getItem('fireisp_refresh_token')).toBeNull();
  });

  it('clears access token when refresh call fails on mount', async () => {
    mockFetch([
      // POST /auth/refresh → failure
      { ok: false, status: 401, json: { error: { message: 'Token expired' } } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.user).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
    // localStorage was never touched — no legacy key to clean up
    expect(localStorage.getItem('fireisp_refresh_token')).toBeNull();
  });

  it('login() stores access token in memory and sets user; no localStorage refresh', async () => {
    const user = { id: 2, email: 'user@test.com', name: 'User', role: 'billing', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    mockFetch([
      // POST /auth/refresh on mount → 401 (no session yet)
      { ok: false, status: 401 },
      // POST /auth/login
      { ok: true, json: { data: { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900, user } } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    await act(async () => {
      await result.current.login('user@test.com', 'secret');
    });

    expect(result.current.user).toMatchObject({ id: 2, email: 'user@test.com' });
    expect(tokenStore.getAccess()).toBe('acc');
    // Refresh token MUST NOT be written to localStorage (httpOnly cookie path)
    expect(localStorage.getItem('fireisp_refresh_token')).toBeNull();
  });

  it('login() throws on server error', async () => {
    mockFetch([
      // POST /auth/refresh on mount → 401
      { ok: false, status: 401 },
      // POST /auth/login → 401
      { ok: false, status: 401, json: { error: { message: 'Invalid credentials' } } },
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
      // POST /auth/refresh on mount → 401
      { ok: false, status: 401 },
      // POST /auth/login
      { ok: true, json: { data: { accessToken: 'a', refreshToken: 'r', expiresIn: 900, user } } },
      // POST /auth/logout
      { ok: true, json: {} },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    await act(async () => { await result.current.login('a@b.com', 'pass'); });
    expect(result.current.user).not.toBeNull();

    await act(async () => { await result.current.logout(); });
    expect(result.current.user).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
  });
});
