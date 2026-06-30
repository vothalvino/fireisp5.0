// =============================================================================
// FireISP 5.0 — Middleware Tests
// =============================================================================

const { validate } = require('../src/middleware/validate');
const { orgScope } = require('../src/middleware/orgScope');

describe('validate middleware', () => {
  function mockReqRes(body) {
    return {
      req: { body },
      res: {},
      next: jest.fn(),
    };
  }

  test('passes when required fields are present', () => {
    const { req, res, next } = mockReqRes({ name: 'John', email: 'john@example.com' });
    const mw = validate({
      name: { type: 'string', required: true },
      email: { type: 'email', required: true },
    });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(); // no error
  });

  test('fails when required field is missing', () => {
    const { req, res, next } = mockReqRes({});
    const mw = validate({
      name: { type: 'string', required: true },
    });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
    }));
  });

  test('fails on invalid email', () => {
    const { req, res, next } = mockReqRes({ email: 'not-an-email' });
    const mw = validate({
      email: { type: 'email', required: true },
    });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
    }));
  });

  test('fails on enum violation', () => {
    const { req, res, next } = mockReqRes({ status: 'unknown' });
    const mw = validate({
      status: { type: 'string', enum: ['active', 'inactive'] },
    });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
    }));
  });

  test('passes on valid enum', () => {
    const { req, res, next } = mockReqRes({ status: 'active' });
    const mw = validate({
      status: { type: 'string', enum: ['active', 'inactive'] },
    });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('checks string min length', () => {
    const { req, res, next } = mockReqRes({ password: 'short' });
    const mw = validate({
      password: { type: 'string', required: true, min: 8 },
    });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
    }));
  });

  test('passes a real boolean through unchanged', () => {
    const { req, res, next } = mockReqRes({ api_use_tls: true });
    const mw = validate({ api_use_tls: { type: 'boolean' } });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.body.api_use_tls).toBe(true);
  });

  // Boolean columns are MySQL tinyint, serialized back as 0/1; an edit form that
  // round-trips such a field re-submits the number. The validator accepts the
  // tinyint form and coerces it so the request is not rejected with a 422.
  test('accepts tinyint 1 for a boolean field and coerces to true', () => {
    const { req, res, next } = mockReqRes({ api_use_tls: 1 });
    const mw = validate({ api_use_tls: { type: 'boolean' } });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(); // no error
    expect(req.body.api_use_tls).toBe(true);
  });

  test('accepts tinyint 0 for a boolean field and coerces to false', () => {
    const { req, res, next } = mockReqRes({ api_use_tls: 0 });
    const mw = validate({ api_use_tls: { type: 'boolean' } });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(); // no error
    expect(req.body.api_use_tls).toBe(false);
  });

  test('still rejects a non-0/1 number for a boolean field', () => {
    const { req, res, next } = mockReqRes({ api_use_tls: 2 });
    const mw = validate({ api_use_tls: { type: 'boolean' } });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
    }));
  });

  test('still rejects a string for a boolean field', () => {
    const { req, res, next } = mockReqRes({ api_use_tls: 'true' });
    const mw = validate({ api_use_tls: { type: 'boolean' } });
    mw(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
    }));
  });
});

describe('orgScope middleware', () => {
  function makeRes() {
    const headers = {};
    return {
      setHeader: (k, v) => { headers[k] = v; },
      getHeader: (k) => headers[k],
      headers,
      status(code) { this._statusCode = code; return this; },
      send(body) { this._body = body; return this; },
      json(body) { this._body = body; return this; },
    };
  }

  test('passes when user has organizationId', (done) => {
    const req = { user: { id: 1, organizationId: 42 }, ip: '127.0.0.1', headers: {}, socket: {} };
    orgScope(req, makeRes(), (err) => {
      expect(err).toBeUndefined();
      expect(req.orgId).toBe(42);
      done();
    });
  });

  test('fails when user has no organizationId', () => {
    const next = jest.fn();
    const req = { user: { id: 1, organizationId: null } };
    orgScope(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
  });

  test('fails when no user', () => {
    const next = jest.fn();
    orgScope({}, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
  });
});
