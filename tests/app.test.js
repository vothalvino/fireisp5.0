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

const app = require('../src/app');

describe('Health Check', () => {
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('5.0.0');
  });
});

describe('404 Handler', () => {
  test('Unknown route returns 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
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
});
