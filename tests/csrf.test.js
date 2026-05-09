// =============================================================================
// FireISP 5.0 — CSRF protection middleware tests (P3.4 + csrf library)
// =============================================================================

jest.mock('../src/config', () => ({
  env: 'test',
  appUrl: 'https://app.fireisp.example.com',
  jwt: { secret: 'test-secret' },
}));

// Mock the csrf library so tests don't need node_modules
const mockVerify = jest.fn();
const mockCreate = jest.fn(() => 'mock-token');
const mockSecretSync = jest.fn(() => 'mock-secret');
jest.mock('csrf', () => {
  return jest.fn().mockImplementation(() => ({
    verify: mockVerify,
    create: mockCreate,
    secretSync: mockSecretSync,
  }));
});

const { csrfOriginCheck, setCsrfCookie, clearCsrfCookie } = require('../src/middleware/csrf');

function mockReq({ method = 'POST', cookies = {}, headers = {}, body = {} } = {}) {
  return { method, cookies, headers, body };
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

beforeEach(() => {
  jest.clearAllMocks();
});

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
  // Bearer-token requests — exempt even when cookies are present
  // (CSRF cannot forge custom Authorization headers cross-origin)
  // =========================================================================
  test('POST with Authorization: Bearer header is exempt even when auth cookies are set', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf_secret: 'secret' },
      headers: { authorization: 'Bearer some-access-token' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(mockVerify).not.toHaveBeenCalled();
    expect(res._status).toBeNull();
  });

  test.each(['PUT', 'PATCH', 'DELETE'])(
    '%s with Authorization: Bearer is exempt from CSRF check',
    (method) => {
      const req = mockReq({
        method,
        cookies: { fireisp_access: 'jwt', fireisp_csrf_secret: 'secret' },
        headers: { authorization: 'Bearer some-access-token' },
      });
      const res = mockRes();
      const next = jest.fn();

      csrfOriginCheck(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(mockVerify).not.toHaveBeenCalled();
    },
  );

  // =========================================================================
  // csrf-library token verification — primary path
  // =========================================================================
  test('POST with valid X-CSRF-Token header is allowed (tokens.verify returns true)', () => {
    mockVerify.mockReturnValue(true);
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf_secret: 'secret' },
      headers: { 'x-csrf-token': 'valid-token' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('secret', 'valid-token');
    expect(next).toHaveBeenCalledWith();
    expect(res._status).toBeNull();
  });

  test('POST with invalid X-CSRF-Token header returns 403 (tokens.verify returns false)', () => {
    mockVerify.mockReturnValue(false);
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf_secret: 'secret' },
      headers: { 'x-csrf-token': 'bad-token' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('secret', 'bad-token');
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.error.code).toBe('FORBIDDEN');
  });

  test('POST with missing X-CSRF-Token header returns 403 when secret cookie is set', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf_secret: 'secret' },
      headers: {},
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  test('POST can also read CSRF token from body._csrf', () => {
    mockVerify.mockReturnValue(true);
    const req = mockReq({
      cookies: { fireisp_access: 'jwt', fireisp_csrf_secret: 'secret' },
      headers: {},
      body: { _csrf: 'body-token' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('secret', 'body-token');
    expect(next).toHaveBeenCalledWith();
  });

  test.each(['PUT', 'PATCH', 'DELETE'])(
    '%s with secret cookie but invalid token returns 403',
    (method) => {
      mockVerify.mockReturnValue(false);
      const req = mockReq({
        method,
        cookies: { fireisp_access: 'jwt', fireisp_csrf_secret: 'secret' },
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
  // Fallback: Origin/Referer check (no fireisp_csrf_secret cookie)
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
  test('sets fireisp_csrf_secret (httpOnly) and fireisp_csrf (not httpOnly) cookies', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);

    expect(res._cookies.fireisp_csrf_secret).toBeDefined();
    expect(res._cookies.fireisp_csrf).toBeDefined();
  });

  test('fireisp_csrf_secret cookie is httpOnly', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(res._cookies.fireisp_csrf_secret.opts.httpOnly).toBe(true);
  });

  test('fireisp_csrf token cookie is NOT httpOnly (must be readable by JS)', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(res._cookies.fireisp_csrf.opts.httpOnly).toBe(false);
  });

  test('fireisp_csrf token cookie has path "/" so SPA can read it on any route', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(res._cookies.fireisp_csrf.opts.path).toBe('/');
  });

  test('fireisp_csrf_secret cookie has path "/api" (server-only)', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(res._cookies.fireisp_csrf_secret.opts.path).toBe('/api');
  });

  test('both cookies are SameSite=Strict', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(res._cookies.fireisp_csrf_secret.opts.sameSite).toBe('strict');
    expect(res._cookies.fireisp_csrf.opts.sameSite).toBe('strict');
  });

  test('uses tokens.secretSync() and tokens.create() to generate values', () => {
    const res = mockRes();
    setCsrfCookie(res, 900_000);
    expect(mockSecretSync).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith('mock-secret');
    expect(res._cookies.fireisp_csrf.value).toBe('mock-token');
  });
});

describe('clearCsrfCookie', () => {
  test('clears both fireisp_csrf_secret and fireisp_csrf cookies', () => {
    const res = mockRes();
    clearCsrfCookie(res);
    expect(res._cleared.fireisp_csrf_secret).toBeDefined();
    expect(res._cleared.fireisp_csrf).toBeDefined();
  });
});
