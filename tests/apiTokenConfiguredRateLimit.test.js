jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));

jest.mock('../src/services/cacheService', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incrementFixedWindow: jest.fn(),
  decrementFixedWindow: jest.fn(),
}));

const db = require('../src/config/database');
const cacheService = require('../src/services/cacheService');
const { apiTokenConfiguredLimiter } = require('../src/middleware/rateLimit');

function makeRequest({ organizationId = 17, tokenId = 9, policy = ACTIVE_POLICY } = {}) {
  return {
    orgId: organizationId,
    user: tokenId === null
      ? { id: 4 }
      : { id: 4, apiTokenId: tokenId, apiTokenRateLimitPolicy: policy },
  };
}

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const ACTIVE_POLICY = {
  requests_per_minute: 1,
  requests_per_hour: 100,
  requests_per_day: 1000,
  burst_size: 10,
  is_active: 1,
};

describe('apiTokenConfiguredLimiter', () => {
  let counters;

  beforeEach(() => {
    jest.clearAllMocks();
    counters = new Map();
    db.withPrimaryContext.mockImplementation(callback => callback());
    cacheService.incrementFixedWindow.mockImplementation(async (key, windowMs) => {
      const count = (counters.get(key) || 0) + 1;
      counters.set(key, count);
      return { count, resetAt: Date.now() + windowMs };
    });
  });

  it('enforces a configured one-request-per-minute policy', async () => {
    const firstNext = jest.fn();
    await apiTokenConfiguredLimiter(makeRequest(), makeResponse(), firstNext);
    expect(firstNext).toHaveBeenCalledWith();

    const secondNext = jest.fn();
    const secondResponse = makeResponse();
    await apiTokenConfiguredLimiter(makeRequest(), secondResponse, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondResponse.statusCode).toBe(429);
    expect(secondResponse.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'API token minute rate limit exceeded' },
    });
    expect(secondResponse.headers['Retry-After']).toBeDefined();
    expect(cacheService.incrementFixedWindow).toHaveBeenCalledWith(
      'rl_api_token_policy:17:9:minute',
      60 * 1000,
    );
    expect(cacheService.incrementFixedWindow).toHaveBeenCalledWith(
      'rl_api_token_policy:17:9:burst',
      1000,
    );
    expect(cacheService.incrementFixedWindow).toHaveBeenCalledWith(
      'rl_api_token_policy:17:9:hour',
      60 * 60 * 1000,
    );
    expect(cacheService.incrementFixedWindow).toHaveBeenCalledWith(
      'rl_api_token_policy:17:9:day',
      24 * 60 * 60 * 1000,
    );
  });

  it('ignores an inactive configuration without touching counters', async () => {
    const next = jest.fn();

    await apiTokenConfiguredLimiter(makeRequest({
      policy: { ...ACTIVE_POLICY, is_active: 0, requests_per_minute: 'malformed-but-inactive' },
    }), makeResponse(), next);

    expect(next).toHaveBeenCalledWith();
    expect(cacheService.incrementFixedWindow).not.toHaveBeenCalled();
  });

  it('uses the policy snapshot from live token authentication without another primary query', async () => {
    const next = jest.fn();

    await apiTokenConfiguredLimiter(
      makeRequest({ organizationId: '42', tokenId: '9001', policy: null }),
      makeResponse(),
      next,
    );

    expect(db.withPrimaryContext).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(cacheService.incrementFixedWindow).not.toHaveBeenCalled();
  });

  it('fails closed when an active database policy is malformed', async () => {
    const next = jest.fn();

    await apiTokenConfiguredLimiter(makeRequest({
      policy: { ...ACTIVE_POLICY, requests_per_minute: 0 },
    }), makeResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 503,
      code: 'RATE_LIMIT_CONFIGURATION_INVALID',
    }));
    expect(cacheService.incrementFixedWindow).not.toHaveBeenCalled();
  });

  it('fails closed when the shared atomic counter is unavailable', async () => {
    cacheService.incrementFixedWindow.mockRejectedValue(new Error('redis unavailable'));
    const next = jest.fn();

    await apiTokenConfiguredLimiter(makeRequest(), makeResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 503,
      code: 'RATE_LIMIT_UNAVAILABLE',
    }));
  });

  it('does not apply token policy to an interactive JWT request', async () => {
    const next = jest.fn();

    await apiTokenConfiguredLimiter(makeRequest({ tokenId: null }), makeResponse(), next);

    expect(next).toHaveBeenCalledWith();
    expect(db.withPrimaryContext).not.toHaveBeenCalled();
  });

  it('keeps each route hard ceiling outside the configured policy layer', () => {
    const fs = require('fs');
    const path = require('path');
    const radiusSource = fs.readFileSync(path.join(__dirname, '../src/routes/radius.js'), 'utf8');
    const flowSource = fs.readFileSync(path.join(__dirname, '../src/routes/connectionLogs.js'), 'utf8');

    expect(radiusSource).toMatch(/router\.post\('\/accounting\/tenant', accountingIngestLimiter, apiTokenConfiguredLimiter,/);
    expect(flowSource).toMatch(/router\.post\('\/cgnat-attribution\/bindings\/ingest', cgnatIngestLimiter, apiTokenConfiguredLimiter,/);
  });
});
