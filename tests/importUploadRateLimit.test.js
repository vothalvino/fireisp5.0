// =============================================================================
// FireISP 5.0 — Import Routes: uploadLimiter mounting (§ escalate-and-upload)
// =============================================================================
// The 5 multipart file-upload routes in src/routes/import.js
// (POST /import/*/upload) accepted unlimited concurrent requests before this
// fix — only the app-wide apiLimiter (default 1000/window) and the admin IP
// allowlist applied. uploadLimiter (src/middleware/rateLimit.js) was already
// fully built and exported but never referenced by any route
// (tests/rateLimiter.test.js only asserted its shape/export, never that it
// was actually MOUNTED anywhere). This file covers both: (1) it's wired onto
// exactly the right 5 routes, in the right position, and (2) it actually
// blocks a request with a real 429 once its budget is exhausted.
// =============================================================================
'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn(), getConnection: jest.fn() }));

// ---------------------------------------------------------------------------
// 1. Static wiring check — uploadLimiter is the exact first middleware layer
// on each of the 5 multipart upload routes (before requirePermission,
// matching bulk.js's bulkEmailLimiter convention), and is absent from the 5
// JSON-body CSV routes (out of scope for this fix). Identity comparison
// (not name/type sniffing) so a differently-configured limiter can't fool it.
// ---------------------------------------------------------------------------
describe('import.js router wiring — uploadLimiter', () => {
  const { uploadLimiter } = require('../src/middleware/rateLimit');
  const importRouter = require('../src/routes/import');

  function routeLayer(path) {
    return importRouter.stack.find((l) => l.route && l.route.path === path);
  }

  const uploadPaths = [
    '/clients/upload', '/devices/upload', '/contracts/upload', '/invoices/upload', '/payments/upload',
  ];
  const jsonPaths = ['/clients', '/devices', '/contracts', '/invoices', '/payments'];

  test.each(uploadPaths)('%s: uploadLimiter is the first middleware', (path) => {
    const layer = routeLayer(path);
    expect(layer).toBeDefined();
    expect(layer.route.stack[0].handle).toBe(uploadLimiter);
  });

  test.each(jsonPaths)('%s (JSON-body CSV route): uploadLimiter is NOT mounted — out of scope', (path) => {
    const layer = routeLayer(path);
    expect(layer).toBeDefined();
    const handles = layer.route.stack.map((l) => l.handle);
    expect(handles).not.toContain(uploadLimiter);
  });
});

// ---------------------------------------------------------------------------
// 2. End-to-end 429 behavior — mount the REAL import router (real
// uploadLimiter, real config) behind a tiny RATE_LIMIT_UPLOAD budget so the
// test is fast and deterministic. auth/orgScope/rbac are mocked per this
// repo's route-test convention (see tests/clientDnd.test.js); the request
// never carries a real file, so any request that gets PAST the limiter
// cheaply 422s in importController (uploadImportFile finds no req.file)
// without touching the DB — matching the existing "returns 422 when no file
// is provided" contract in tests/importController.test.js. This also proves
// the middleware ORDER is correct: a rate-limited request is rejected before
// multer ever parses anything.
// ---------------------------------------------------------------------------
describe('import.js upload routes — real 429 after budget exhausted', () => {
  function loadFreshImportApp(budget) {
    jest.resetModules();
    process.env.RATE_LIMIT_UPLOAD = String(budget);
    jest.doMock('../src/config/database', () => ({ query: jest.fn(), getConnection: jest.fn() }));
    jest.doMock('../src/middleware/auth', () => ({
      authenticate: (req, _res, next) => {
        req.user = { id: 1, organizationId: 1, role: 'admin' };
        next();
      },
    }));
    jest.doMock('../src/middleware/orgScope', () => ({
      orgScope: (req, _res, next) => {
        req.orgId = req.user.organizationId;
        next();
      },
    }));
    jest.doMock('../src/middleware/rbac', () => ({
      requirePermission: () => (_req, _res, next) => next(),
    }));
    const express = require('express');
    const importRoutes = require('../src/routes/import');
    const app = express();
    app.use(express.json());
    app.use('/import', importRoutes);
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 500).json({ error: { message: err.message } });
    });
    return app;
  }

  afterEach(() => {
    delete process.env.RATE_LIMIT_UPLOAD;
  });

  test('POST /import/clients/upload: a budget of 2 allows 2 requests then 429s the 3rd', async () => {
    const request = require('supertest');
    const app = loadFreshImportApp(2);

    const r1 = await request(app).post('/import/clients/upload');
    const r2 = await request(app).post('/import/clients/upload');
    const r3 = await request(app).post('/import/clients/upload');

    // Both allowed requests reach the controller (no file attached -> 422,
    // never a 429) — proves the limiter's budget, not an unrelated failure,
    // is what blocks the 3rd request.
    expect(r1.status).toBe(422);
    expect(r2.status).toBe(422);
    expect(r3.status).toBe(429);
    expect(r3.body).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'RATE_LIMITED' }),
    }));
  });

  test('a rate-limited request never reaches multer/the controller (limiter runs first)', async () => {
    const request = require('supertest');
    const app = loadFreshImportApp(1);

    const r1 = await request(app).post('/import/devices/upload');
    expect(r1.status).toBe(422); // allowed through -> controller's own "no file" 422

    const r2 = await request(app).post('/import/devices/upload');
    expect(r2.status).toBe(429); // blocked before multer/controller ever runs
    expect(r2.body.error.code).toBe('RATE_LIMITED');
  });

  test('the budget is a single shared instance across all 5 upload routes, not one budget per route', async () => {
    // uploadLimiter is ONE middleware instance (module-level const in
    // rateLimit.js) mounted on all 5 routes, and express-rate-limit's
    // default in-memory store keys purely by IP (not by route — see the
    // verifyEmailResendLimiter/bulkEmailLimiter precedent comments in
    // rateLimit.js) — a request against ANY of the 5 routes consumes the
    // SAME per-IP budget as the others. This is the intended design here
    // (unlike those other limiters, which deliberately use SEPARATE
    // instances because they gate semantically different actions): all 5
    // import-upload endpoints are the same class of action being protected
    // from the same abuse (hammering the CSV parser/DB), so one combined
    // budget across the group is correct, not a per-endpoint bug.
    const request = require('supertest');
    const app = loadFreshImportApp(1);

    const r1 = await request(app).post('/import/clients/upload');
    expect(r1.status).toBe(422); // consumes the shared budget of 1

    const paths = [
      '/import/devices/upload', '/import/contracts/upload',
      '/import/invoices/upload', '/import/payments/upload',
    ];
    for (const path of paths) {
      const res = await request(app).post(path);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    }
  });
});
