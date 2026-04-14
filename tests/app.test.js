// =============================================================================
// FireISP 5.0 — App Integration Tests
// =============================================================================
// Tests the Express application routes, middleware, and error handling
// without requiring a live database connection.
// =============================================================================

const request = require('supertest');

// Mock the database module before requiring app
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const app = require('../src/app');

describe('Health Check', () => {
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('5.0.0');
  });

  test('GET /health includes uptime and relay fields', async () => {
    const res = await request(app).get('/health');
    expect(res.body.uptime).toEqual(expect.any(Number));
    expect(res.body).toHaveProperty('relay');
    expect(res.body.timestamp).toBeDefined();
  });

  test('GET /health?detail=true includes memory and db info when DB is reachable', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/health?detail=true');
    expect(res.status).toBe(200);
    expect(res.body.memory).toBeDefined();
    expect(res.body.memory.rss).toEqual(expect.any(Number));
    expect(res.body.memory.heapUsed).toEqual(expect.any(Number));
    expect(res.body.db).toEqual({ connected: true, latencyMs: expect.any(Number) });
  });

  test('GET /health?detail=true returns degraded when DB is down', async () => {
    db.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app).get('/health?detail=true');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toEqual({ connected: false });
  });
});

describe('Liveness Probe', () => {
  test('GET /health/live returns ok', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('Readiness Probe', () => {
  test('GET /health/ready returns ready when DB is up', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.db.connected).toBe(true);
    expect(res.body.checks.db.latencyMs).toEqual(expect.any(Number));
  });

  test('GET /health/ready returns not_ready when DB is down', async () => {
    db.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks.db.connected).toBe(false);
  });
});

describe('404 Handler', () => {
  test('Unknown route returns 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('404 response includes error message', async () => {
    const res = await request(app).get('/api/no-such-route');
    expect(res.body.error.message).toBe('Route not found');
  });
});

describe('Global Error Handler', () => {
  // We can trigger the MySQL error handlers by manipulating routes.
  // Instead, test via the exported app's error-handling middleware indirectly.

  test('handles MySQL duplicate key error (ER_DUP_ENTRY)', async () => {
    // POST to /api/auth/register triggers the route. Mock User.findByEmail then User.create to throw ER_DUP_ENTRY.
    // Simplest: make db.query throw the MySQL-shaped error in the chain.
    const dupError = new Error('Duplicate entry');
    dupError.code = 'ER_DUP_ENTRY';
    dupError.errno = 1062;

    db.query.mockRejectedValueOnce(dupError); // findByEmail throws

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Test', lastName: 'User', email: 'dup@example.com',
        password: 'password123',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('handles MySQL trigger error (ER_SIGNAL_EXCEPTION)', async () => {
    const triggerError = new Error('Trigger violation');
    triggerError.code = 'ER_SIGNAL_EXCEPTION';
    triggerError.errno = 1644;
    triggerError.sqlMessage = 'Custom trigger message';

    db.query.mockRejectedValueOnce(triggerError);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Test', lastName: 'User', email: 'trigger@example.com',
        password: 'password123',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DB_RULE_VIOLATION');
  });

  test('handles MySQL FK constraint error', async () => {
    const fkError = new Error('FK constraint');
    fkError.code = 'ER_NO_REFERENCED_ROW_2';
    fkError.errno = 1452;

    db.query.mockRejectedValueOnce(fkError);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Test', lastName: 'User', email: 'fk@example.com',
        password: 'password123',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FK_VIOLATION');
  });
});

describe('Auth Routes', () => {
  test('POST /api/auth/login without body returns 422', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /api/auth/register validates required fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toBeDefined();
  });

  test('GET /api/auth/me without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('CORS Configuration', () => {
  test('responds with CORS headers for allowed localhost origin in development', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('does not reflect arbitrary origins in development', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://evil-site.com');
    // cors will not set access-control-allow-origin for disallowed origins
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('OPTIONS preflight returns CORS headers for allowed origin', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  test('allows 127.0.0.1:5173 origin in development', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://127.0.0.1:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });
});

describe('Security Headers', () => {
  test('responses include CSP header with nonce', async () => {
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("'nonce-");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  test('responses include Helmet security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('API Versioning and Deprecation', () => {
  test('GET /api/* includes deprecation and sunset headers', async () => {
    const res = await request(app).get('/api/clients');
    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2027-06-01');
    expect(res.headers['link']).toContain('/api/v1');
  });
});

describe('Webhook Endpoint Accessibility', () => {
  test('payment-webhooks rate limiter is mounted', async () => {
    // The webhookLimiter is mounted for /api/v1/payment-webhooks path
    // Verify the path responds with rate limit headers (not a 404 from missing middleware)
    const res = await request(app)
      .post('/api/v1/payment-webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({ type: 'test' });
    // May return various status codes depending on route, but rate limit headers should be present
    const hasRateLimitHeaders = res.headers['ratelimit-limit'] ||
                                 res.headers['ratelimit-remaining'] ||
                                 res.headers['ratelimit'];
    expect(hasRateLimitHeaders).toBeDefined();
  });
});

describe('Protected Routes', () => {
  test('GET /api/clients without auth returns 401', async () => {
    const res = await request(app).get('/api/clients');
    expect(res.status).toBe(401);
  });

  test('GET /api/invoices without auth returns 401', async () => {
    const res = await request(app).get('/api/invoices');
    expect(res.status).toBe(401);
  });

  test('GET /api/devices without auth returns 401', async () => {
    const res = await request(app).get('/api/devices');
    expect(res.status).toBe(401);
  });

  test('GET /api/plans without auth returns 401', async () => {
    const res = await request(app).get('/api/plans');
    expect(res.status).toBe(401);
  });

  test('GET /api/contracts without auth returns 401', async () => {
    const res = await request(app).get('/api/contracts');
    expect(res.status).toBe(401);
  });

  test('GET /api/tickets without auth returns 401', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  test('GET /api/payments without auth returns 401', async () => {
    const res = await request(app).get('/api/payments');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/clients without auth returns 401', async () => {
    const res = await request(app).get('/api/v1/clients');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/organizations without auth returns 401', async () => {
    const res = await request(app).get('/api/v1/organizations');
    expect(res.status).toBe(401);
  });
});

describe('Metrics Endpoint', () => {
  test('GET /metrics returns metrics data', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
  });
});
