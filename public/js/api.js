// =============================================================================
// FireISP 5.0 — API Client
// =============================================================================
// Thin wrapper around fetch() with JWT auth, error handling, and pagination.
// =============================================================================

/* global window, localStorage, fetch */

const API = (() => {
  const BASE = '/api';

  function token() { return localStorage.getItem('fireisp_token'); }
  function setToken(t) { localStorage.setItem('fireisp_token', t); }
  function clearToken() { localStorage.removeItem('fireisp_token'); }
  function orgId() { return localStorage.getItem('fireisp_org'); }
  function setOrgId(id) { localStorage.setItem('fireisp_org', id); }

  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const o = orgId();
    if (o) headers['X-Org-Id'] = o;
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const cfg = { method, headers, ...opts };
    if (body && method !== 'GET') cfg.body = JSON.stringify(body);

    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    const res = await fetch(url, cfg);

    if (res.status === 401) {
      clearToken();
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
      if (res.data?.token) setToken(res.data.token);
      return res.data;
    },

    async me() {
      const res = await request('GET', '/auth/me');
      return res.data;
    },

    async logout() {
      try { await request('POST', '/auth/logout'); } catch (_e) { /* ignore */ }
      clearToken();
      localStorage.removeItem('fireisp_org');
    },
  };
})();
