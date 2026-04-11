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
});

describe('orgScope middleware', () => {
  test('passes when user has organizationId', () => {
    const next = jest.fn();
    const req = { user: { id: 1, organizationId: 42 } };
    orgScope(req, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.orgId).toBe(42);
  });

  test('fails when user has no organizationId', () => {
    const next = jest.fn();
    const req = { user: { id: 1, organizationId: null } };
    orgScope(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
  });

  test('fails when no user', () => {
    const next = jest.fn();
    orgScope({}, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
    }));
  });
});
