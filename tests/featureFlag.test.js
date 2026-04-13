// =============================================================================
// FireISP 5.0 — Feature Flag Middleware Tests
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

  test('calls next() when feature is enabled', () => {
    config.features.cfdi = true;
    const next = jest.fn();
    requireFeature('cfdi')({}, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 404 when feature is disabled', () => {
    config.features.cfdi = false;
    const res = mockRes();
    const next = jest.fn();
    requireFeature('cfdi')({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  test('works for each feature flag', () => {
    for (const flag of ['cfdi', 'radius', 'twoFactor', 'webhooks', 'snmp']) {
      config.features[flag] = true;
      const next = jest.fn();
      requireFeature(flag)({}, mockRes(), next);
      expect(next).toHaveBeenCalled();

      config.features[flag] = false;
      const next2 = jest.fn();
      const res = mockRes();
      requireFeature(flag)({}, res, next2);
      expect(next2).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    }
  });

  test('returns 404 for undefined feature flag', () => {
    const res = mockRes();
    const next = jest.fn();
    requireFeature('nonexistent')({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });
});
