// =============================================================================
// FireISP 5.0 — PortalAuthContext tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PortalAuthProvider, usePortalAuth, portalTokenStore } from '../PortalAuthContext';

function wrapper({ children }: { children: ReactNode }) {
  return <PortalAuthProvider>{children}</PortalAuthProvider>;
}

function mockFetch(responses: Array<{ ok: boolean; json?: object; status?: number }>) {
  let i = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 401),
      json: () => Promise.resolve(r.json ?? {}),
    } as Response);
  });
}

const client = { id: 1, name: 'Acme Co', email: 'c@acme.com', organization_id: 1 };

describe('PortalAuthContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    portalTokenStore.clear();
    localStorage.clear();
  });

  it('settles logged-out when there is no portal refresh token', async () => {
    const fetchSpy = mockFetch([{ ok: true, json: { data: client } }]);
    const { result } = renderHook(() => usePortalAuth(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.client).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // no token → no network call
  });

  it('restores the session: refresh then /me', async () => {
    portalTokenStore.setRefresh('portal-refresh-1');
    mockFetch([
      { ok: true, json: { data: { accessToken: 'pa', refreshToken: 'pr2' } } }, // POST /portal/auth/refresh
      { ok: true, json: { data: client } },                                     // GET /portal/auth/me
    ]);

    const { result } = renderHook(() => usePortalAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current.client).toMatchObject({ id: 1, name: 'Acme Co' });
    expect(portalTokenStore.getAccess()).toBe('pa');
  });

  it('does NOT bounce to login on a transient 429 during refresh — retries then restores', async () => {
    portalTokenStore.setRefresh('portal-refresh-1');
    mockFetch([
      { ok: false, status: 429 },                                               // refresh → rate-limited (transient)
      { ok: true, json: { data: { accessToken: 'pa', refreshToken: 'pr2' } } }, // retry refresh → ok
      { ok: true, json: { data: client } },                                     // me → ok
    ]);

    const { result } = renderHook(() => usePortalAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true), { timeout: 3000 });

    expect(result.current.client).toMatchObject({ id: 1 });
  });

  it('logs out on a definitive 401 refresh (expired / invalid token)', async () => {
    portalTokenStore.setRefresh('portal-refresh-1');
    mockFetch([{ ok: false, status: 401 }]);

    const { result } = renderHook(() => usePortalAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    expect(result.current.client).toBeNull();
    expect(portalTokenStore.getRefresh()).toBeNull(); // cleared
  });
});
