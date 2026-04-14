// =============================================================================
// FireISP 5.0 — Feature Flag Middleware Tests (Extended)
// =============================================================================

const config = require('../src/config');
const { requireFeature } = require('../src/middleware/featureFlag');

describe('requireFeature middleware', () => {
  const originalFeatures = { ...config.features };

  afterEach(() => {
    Object.assign(config.features, originalFeatures);
  });

  function mockRes() {
    const res = {
      statusCode: null,
      body: null,
      status(code) { res.statusCode = code; return res; },
      json(data) { res.body = data; return res; },
    };
    return res;
  }

  test('calls next() when cfdi feature is enabled', () => {
    config.features.cfdi = true;
    const next = jest.fn();
    requireFeature('cfdi')({}, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 404 with FEATURE_DISABLED code when feature is disabled', () => {
    config.features.cfdi = false;
    const res = mockRes();
    const next = jest.fn();
    requireFeature('cfdi')({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    expect(res.body.error.message).toContain('cfdi');
  });

  test('calls next() when radius feature is enabled', () => {
    config.features.radius = true;
    const next = jest.fn();
    requireFeature('radius')({}, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('calls next() when twoFactor feature is enabled', () => {
    config.features.twoFactor = true;
    const next = jest.fn();
    requireFeature('twoFactor')({}, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('calls next() when webhooks feature is enabled', () => {
    config.features.webhooks = true;
    const next = jest.fn();
    requireFeature('webhooks')({}, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('calls next() when snmp feature is enabled', () => {
    config.features.snmp = true;
    const next = jest.fn();
    requireFeature('snmp')({}, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 404 for each known feature when disabled', () => {
    for (const flag of ['cfdi', 'radius', 'twoFactor', 'webhooks', 'snmp']) {
      config.features[flag] = false;
      const res = mockRes();
      const next = jest.fn();
      requireFeature(flag)({}, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('FEATURE_DISABLED');
      expect(res.body.error.message).toContain(flag);
    }
  });

  test('returns 404 for unknown feature names', () => {
    const res = mockRes();
    const next = jest.fn();
    requireFeature('nonexistent')({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    expect(res.body.error.message).toContain('nonexistent');
  });
});
