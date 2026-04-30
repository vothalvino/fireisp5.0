// =============================================================================
// FireISP 5.0 — CSRF protection middleware tests (P3.4 + CSRF double-submit)
// =============================================================================

jest.mock('../src/config', () => ({
  env: 'test',
  appUrl: 'https://app.fireisp.example.com',
  jwt: { secret: 'test-secret' },
}));

const { csrfOriginCheck, setCsrfCookie, clearCsrfCookie } = require('../src/middleware/csrf');

function mockReq({ method = 'POST', cookies = {}, headers = {} } = {}) {
  return { method, cookies, headers };
}

function mockRes() {
  const res = {
    _status: null,
    _body: null,
    _cookies: {},
    _cleared: {},
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    cookie(name, value, opts) { this._cookies[name] = { value, opts }; return this; },
    clearCookie(name, opts) { this._cleared[name] = opts; return this; },
  };
  return res;
}

describe('csrfOriginCheck', () => {
  // =========================================================================
  // Safe methods — always pass through
  // =========================================================================
  test.each(['GET', 'HEAD', 'OPTIONS'])(
    '%s requests are always allowed (no CSRF check)',
    (method) => {
      const req = mockReq({ method, cookies: { fireisp_access: 'some-jwt' } });
      const res = mockRes();
      const next = jest.fn();

      csrfOriginCheck(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res._status).toBeNull();
    },
  );

  // =========================================================================
  // No cookie present — API-key / Bearer-only clients pass through
  // =========================================================================
  test('POST without any FireISP cookie is allowed (Bearer/API-key client)', () => {
    const req = mockReq({ method: 'POST', cookies: {} });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  // =========================================================================
  // Double-submit CSRF token — primary path (fireisp_csrf cookie present)
  // =========================================================================
  test('POST with matching X-CSRF-Token header and fireisp_csrf cookie is allowed', () => {
    const token = 'abc123';
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf: token },
      headers: { 'x-csrf-token': token },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res._status).toBeNull();
  });

  test('POST with wrong X-CSRF-Token header returns 403', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf: 'real-token' },
      headers: { 'x-csrf-token': 'wrong-token' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.error.code).toBe('FORBIDDEN');
  });

  test('POST with missing X-CSRF-Token header returns 403 when fireisp_csrf cookie is set', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf: 'real-token' },
      headers: {},
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  test.each(['PUT', 'PATCH', 'DELETE'])(
    '%s with fireisp_csrf cookie but wrong header returns 403',
    (method) => {
      const req = mockReq({
        method,
        cookies: { fireisp_access: 'jwt', fireisp_csrf: 'real-token' },
        headers: { 'x-csrf-token': 'bad' },
      });
      const res = mockRes();
      const next = jest.fn();

      csrfOriginCheck(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    },
  );

  // =========================================================================
  // Fallback: Origin/Referer check (no fireisp_csrf cookie)
  // =========================================================================
  test('POST with fireisp_access cookie and correct Origin is allowed (fallback)', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt' },
      headers: { origin: 'https://app.fireisp.example.com' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('POST with fireisp_refresh cookie and correct Origin is allowed (fallback)', () => {
    const req = mockReq({
      cookies: { fireisp_refresh: 'opaque-token' },
      headers: { origin: 'https://app.fireisp.example.com' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('POST falls back to Referer when no Origin header (fallback)', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt' },
      headers: { referer: 'https://app.fireisp.example.com/some/page' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('POST with cookie and wrong Origin returns 403 (fallback)', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt' },
      headers: { origin: 'https://evil.attacker.com' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.error.code).toBe('FORBIDDEN');
  });

  test('POST with cookie and no Origin/Referer header returns 403 (fallback)', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt' },
      headers: {},
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  test.each(['PUT', 'PATCH', 'DELETE'])(
    '%s with cookie and wrong Origin returns 403 (fallback)',
    (method) => {
      const req = mockReq({
        method,
        cookies: { fireisp_access: 'jwt' },
        headers: { origin: 'https://evil.attacker.com' },
      });
      const res = mockRes();
      const next = jest.fn();

      csrfOriginCheck(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(403);
    },
  );
});

// =============================================================================
// setCsrfCookie / clearCsrfCookie helpers
// =============================================================================
describe('setCsrfCookie', () => {
  test('sets fireisp_csrf cookie with 64-char hex token', () => {
    const res = mockRes();
    const token = setCsrfCookie(res, 900_000);

    expect(typeof token).toBe('string');
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    expect(res._cookies.fireisp_csrf).toBeDefined();
    expect(res._cookies.fireisp_csrf.value).toBe(token);
  });

  test('cookie is NOT httpOnly (must be readable by JS)', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(res._cookies.fireisp_csrf.opts.httpOnly).toBe(false);
  });

  test('cookie is SameSite=Strict', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(res._cookies.fireisp_csrf.opts.sameSite).toBe('strict');
  });

  test('two calls generate different tokens', () => {
    const res1 = mockRes();
    const res2 = mockRes();
    const t1 = setCsrfCookie(res1, 900_000);
    const t2 = setCsrfCookie(res2, 900_000);
    expect(t1).not.toBe(t2);
  });
});

describe('clearCsrfCookie', () => {
  test('calls res.clearCookie for fireisp_csrf', () => {
    const res = mockRes();
    clearCsrfCookie(res);
    expect(res._cleared.fireisp_csrf).toBeDefined();
  });
});
