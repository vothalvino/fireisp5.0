import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gql } from '@/api/graphql';
import { tokenStore } from '@/api/client';

// Regression: graphql-request constructs `new URL(endpoint)` when a custom fetch
// is supplied, which throws "Invalid URL" on a RELATIVE path BEFORE sending the
// request — so the GraphQL POST never fired and ClientDetail showed
// "Client not found" for every client. The endpoint must be absolute.
describe('gql()', () => {
  const clearCsrf = () => { document.cookie = 'fireisp_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'; };
  beforeEach(() => { tokenStore.clear(); clearCsrf(); vi.restoreAllMocks(); });

  it('actually fires a request to an absolute /api/v1/graphql URL', async () => {
    tokenStore.setAccess('tok');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await gql('query { ok }');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https?:\/\/.+\/api\/v1\/graphql$/);
  });

  it('sends Bearer + X-CSRF-Token (through authedFetch)', async () => {
    tokenStore.setAccess('tok-7');
    document.cookie = 'fireisp_csrf=csrf-9';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await gql('query { ok }');

    const init = fetchMock.mock.calls[0][1];
    const h = new Headers(init.headers);
    expect(h.get('Authorization')).toBe('Bearer tok-7');
    expect(h.get('X-CSRF-Token')).toBe('csrf-9');
    expect(init.credentials).toBe('include');
    clearCsrf();
  });
});
