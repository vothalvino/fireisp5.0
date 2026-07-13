// =============================================================================
// FireISP 5.0 — Data Security Route Error Tests (§17)
// Tests the error catch blocks that can't be triggered from section17.test.js
// because securityService is not mocked there.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (_req, _res, next) => {
    _req.user = { id: 1, email: 'test@test.com', role: 'admin', organizationId: 1 };
    next();
  },
  optionalAuth: (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (_req, _res, next) => { _req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/rateLimit', () => ({
  apiLimiter: (_req, _res, next) => next(),
  sessionLimiter: (_req, _res, next) => next(),
  authLimiter: (_req, _res, next) => next(),
  passwordResetLimiter: (_req, _res, next) => next(),
  verifyEmailResendLimiter: (_req, _res, next) => next(),
  bulkEmailLimiter: (_req, _res, next) => next(),
  publicLimiter: (_req, _res, next) => next(),
  uploadLimiter: (_req, _res, next) => next(),
  exportLimiter: (_req, _res, next) => next(),
  sseLimiter: (_req, _res, next) => next(),
  webhookLimiter: (_req, _res, next) => next(),
  tenantApiLimiter: (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/featureFlag', () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));

// Mock securityService so we can control when runSecureDeletion throws
jest.mock('../src/services/securityService', () => ({
  runSecureDeletion: jest.fn(),
}));

process.env.RATE_LIMIT_API = '9999';
process.env.RATE_LIMIT_TENANT_API = '9999';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const securityService = require('../src/services/securityService');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

describe('POST /api/v1/data-security/secure-deletion — service error', () => {
  beforeEach(() => {
    securityService.runSecureDeletion.mockRejectedValue(new Error('Retention service failed'));
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 500 when securityService.runSecureDeletion throws', async () => {
    const res = await request(app)
      .post('/api/v1/data-security/secure-deletion')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/data-security/secure-deletion — success path via mocked service', () => {
  beforeEach(() => {
    securityService.runSecureDeletion.mockResolvedValue({
      total_deleted: 3,
      logged: true,
      tables: [{ table: 'dsar_requests', deleted: 3 }],
    });
  });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with stats when service succeeds', async () => {
    const res = await request(app)
      .post('/api/v1/data-security/secure-deletion')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total_deleted).toBe(3);
  });
});
