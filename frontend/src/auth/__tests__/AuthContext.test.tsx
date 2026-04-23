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

  it('initialises and settles with no user when no refresh token exists', async () => {
    // No refresh token in localStorage → fast path: setState without fetch
    const { result } = renderHook(() => useAuth(), { wrapper });

    // After effects settle, initialized without user
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('restores session silently when a valid refresh token exists', async () => {
    localStorage.setItem('fireisp_refresh_token', 'test-refresh-token');

    const user = { id: 1, email: 'admin@test.com', name: 'Admin', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    mockFetch([
      // POST /auth/refresh → success
      { ok: true, json: { data: { accessToken: 'access-1', refreshToken: 'refresh-2' } } },
      // GET /auth/me → success
      { ok: true, json: { data: user } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current.user).toMatchObject({ id: 1, email: 'admin@test.com' });
    expect(result.current.loading).toBe(false);
  });

  it('clears tokens when refresh call fails on mount', async () => {
    localStorage.setItem('fireisp_refresh_token', 'expired-token');

    mockFetch([
      // POST /auth/refresh → failure
      { ok: false, status: 401, json: { error: { message: 'Token expired' } } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('fireisp_refresh_token')).toBeNull();
  });

  it('login() stores tokens and sets user', async () => {
    const user = { id: 2, email: 'user@test.com', name: 'User', role: 'billing', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    mockFetch([
      // No refresh token on mount → fast path
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
    expect(localStorage.getItem('fireisp_refresh_token')).toBe('ref');
  });

  it('login() throws on server error', async () => {
    mockFetch([
      { ok: false, status: 401, json: { error: { message: 'Invalid credentials' } } },
    ]);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    await expect(
      act(async () => { await result.current.login('bad@test.com', 'wrong'); })
    ).rejects.toThrow('Invalid credentials');
  });

  it('logout() clears tokens and user', async () => {
    const user = { id: 1, email: 'a@b.com', name: 'A', role: 'admin', organization_id: 1, is_active: true, email_verified: true, twofa_enabled: false };

    mockFetch([
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
