// =============================================================================
// FireISP 5.0 — DR Drill Routes Tests
// =============================================================================
// GET /dr-drill/runbook serves docs/dr-drill.md (the in-app runbook the
// DrDrillBanner modal links to — its old /docs/dr-drill.md href 404'd because
// nothing serves repo files).

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const User = require('../src/models/User');
const app = require('../src/app');

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1, email: 'test@example.com', status: 'active', role: 'admin', organization_id: 1,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/v1/dr-drill/runbook', () => {
  test('requires authentication', async () => {
    const res = await request(app).get('/api/v1/dr-drill/runbook');
    expect(res.status).toBe(401);
  });

  test('returns the runbook markdown from docs/dr-drill.md', async () => {
    mockAuthUser();
    const res = await request(app)
      .get('/api/v1/dr-drill/runbook')
      .set('Authorization', `Bearer ${makeToken()}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(typeof res.body.data.markdown).toBe('string');
    // Content of the real repo doc — this test reads the actual file, so it
    // also guards against the doc being moved without updating the route.
    expect(res.body.data.markdown).toContain('Disaster-Recovery Drill');
    expect(res.body.data.markdown).toContain('Quarterly Drill Log');
  });
});
