// =============================================================================
// FireISP 5.0 — API Client
// =============================================================================
// Thin wrapper around fetch() with JWT auth, error handling, and pagination.
// Supports refresh token rotation: short-lived access token + long-lived
// refresh token. Automatically refreshes the access token on 401 responses.
// =============================================================================

/* global window, localStorage, fetch */

const API = (() => {
  const BASE = '/api';

  let refreshPromise = null; // singleton to avoid concurrent refresh calls

  function accessToken() { return localStorage.getItem('fireisp_token'); }
  function setAccessToken(t) { localStorage.setItem('fireisp_token', t); }
  function refreshTokenVal() { return localStorage.getItem('fireisp_refresh'); }
  function setRefreshToken(t) { localStorage.setItem('fireisp_refresh', t); }
  function clearTokens() {
    localStorage.removeItem('fireisp_token');
    localStorage.removeItem('fireisp_refresh');
  }
  function orgId() { return localStorage.getItem('fireisp_org'); }
  function setOrgId(id) { localStorage.setItem('fireisp_org', id); }

  // Backward compat: token() returns the access token
  function token() { return accessToken(); }
  function setToken(t) { setAccessToken(t); }
  function clearToken() { clearTokens(); }

  /**
   * Attempt to refresh the access token using the stored refresh token.
   * Returns true on success, false on failure.
   */
  async function tryRefresh() {
    const rt = refreshTokenVal();
    if (!rt) return false;

    // Deduplicate concurrent refresh attempts
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return false;
        const json = await res.json();
        if (json.data?.accessToken) {
          setAccessToken(json.data.accessToken);
          setRefreshToken(json.data.refreshToken);
          return true;
        }
        return false;
      } catch (_e) {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  async function request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = accessToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    const o = orgId();
    if (o) headers['X-Org-Id'] = o;
    const cfg = { method, headers, ...opts };
    if (body && method !== 'GET') cfg.body = JSON.stringify(body);

    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    let res = await fetch(url, cfg);

    // On 401, try to refresh the access token and retry once
    if (res.status === 401 && !opts._retried) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        headers.Authorization = `Bearer ${accessToken()}`;
        cfg.headers = headers;
        res = await fetch(url, { ...cfg, _retried: true });
      }
    }

    if (res.status === 401) {
      clearTokens();
      window.location.hash = '#/login';
      throw new Error('Session expired');
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error?.message || json.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  return {
    get:    (p, opts) => request('GET', p, null, opts),
    post:   (p, b)    => request('POST', p, b),
    put:    (p, b)    => request('PUT', p, b),
    patch:  (p, b)    => request('PATCH', p, b),
    delete: (p)       => request('DELETE', p),

    token, setToken, clearToken,
    orgId, setOrgId,

    // Auth helpers
    async login(email, password) {
      const res = await request('POST', '/auth/login', { email, password });
      if (res.data?.accessToken) {
        setAccessToken(res.data.accessToken);
        setRefreshToken(res.data.refreshToken);
      }
      return res.data;
    },

    async me() {
      const res = await request('GET', '/auth/me');
      return res.data;
    },

    async logout() {
      const rt = refreshTokenVal();
      try { await request('POST', '/auth/logout', { refreshToken: rt }); } catch (_e) { /* ignore */ }
      clearTokens();
      localStorage.removeItem('fireisp_org');
    },
  };
})();
