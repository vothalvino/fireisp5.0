// =============================================================================
// FireISP 5.0 — CSRF origin-check middleware tests (P3.4)
// =============================================================================

jest.mock('../src/config', () => ({
  env: 'test',
  appUrl: 'https://app.fireisp.example.com',
  jwt: { secret: 'test-secret' },
}));

const { csrfOriginCheck } = require('../src/middleware/csrf');

function mockReq({ method = 'POST', cookies = {}, headers = {} } = {}) {
  return { method, cookies, headers };
}

function mockRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
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
  // Cookie present + matching Origin → allowed
  // =========================================================================
  test('POST with fireisp_access cookie and correct Origin is allowed', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt' },
      headers: { origin: 'https://app.fireisp.example.com' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('POST with fireisp_refresh cookie and correct Origin is allowed', () => {
    const req = mockReq({
      cookies: { fireisp_refresh: 'opaque-token' },
      headers: { origin: 'https://app.fireisp.example.com' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('POST falls back to Referer when no Origin header', () => {
    const req = mockReq({
      cookies: { fireisp_access: 'jwt' },
      headers: { referer: 'https://app.fireisp.example.com/some/page' },
    });
    const res = mockRes();
    const next = jest.fn();

    csrfOriginCheck(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  // =========================================================================
  // Cookie present + wrong/missing Origin → 403
  // =========================================================================
  test('POST with cookie and wrong Origin returns 403', () => {
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

  test('POST with cookie and no Origin/Referer header returns 403', () => {
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
    '%s with cookie and wrong Origin returns 403',
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
