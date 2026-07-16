// =============================================================================
// FireISP 5.0 — Client DND Preference Tests — §1.4
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

// Mock auth + orgScope + rbac so route tests work without a real DB
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organizationId: 1, role: 'admin' };
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = req.user.organizationId;
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
}));

// Mock rateLimit middleware to avoid Redis dependency
jest.mock('../src/middleware/rateLimit', () => ({
  tenantApiLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
  sessionLimiter: (_req, _res, next) => next(),
  authLimiter: (_req, _res, next) => next(),
  exportLimiter: (_req, _res, next) => next(),
  sseLimiter: (_req, _res, next) => next(),
  webhookLimiter: (_req, _res, next) => next(),
}));

const request = require('supertest');
const express = require('express');
const db = require('../src/config/database');
const ClientDndPreference = require('../src/models/ClientDndPreference');
const clientDndRoutes = require('../src/routes/clientDnd');

// ---------------------------------------------------------------------------
// Build a minimal Express app for route testing
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  // Mount at /clients to match the pattern in app.js
  app.use('/clients', clientDndRoutes);
  // Simple error handler
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: { message: err.message } });
  });
  return app;
}

// ---------------------------------------------------------------------------
// ClientDndPreference model
// ---------------------------------------------------------------------------
describe('ClientDndPreference model', () => {
  test('tableName is client_dnd_preferences', () => {
    expect(ClientDndPreference.tableName).toBe('client_dnd_preferences');
  });

  test('hasOrgScope is true', () => {
    expect(ClientDndPreference.hasOrgScope).toBe(true);
  });

  test('fillable contains expected columns', () => {
    expect(ClientDndPreference.fillable).toContain('organization_id');
    expect(ClientDndPreference.fillable).toContain('client_id');
    expect(ClientDndPreference.fillable).toContain('channel');
    expect(ClientDndPreference.fillable).toContain('opt_out');
    expect(ClientDndPreference.fillable).toContain('quiet_hours_start');
    expect(ClientDndPreference.fillable).toContain('quiet_hours_end');
    expect(ClientDndPreference.fillable).toContain('reason');
  });

  test('softDelete is not enabled', () => {
    expect(ClientDndPreference.softDelete).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// GET /clients/:clientId/dnd
// ---------------------------------------------------------------------------
describe('GET /clients/:clientId/dnd', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('returns DND preferences for a client', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, client_id: 5, channel: 'email', opt_out: 1 },
      { id: 2, client_id: 5, channel: 'sms',   opt_out: 0 },
    ]]);

    const res = await request(app).get('/clients/5/dnd');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].channel).toBe('email');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('client_dnd_preferences'),
      [5, 1],
    );
  });

  test('returns empty array when client has no DND prefs', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app).get('/clients/99/dnd');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PUT /clients/:clientId/dnd
// ---------------------------------------------------------------------------
describe('PUT /clients/:clientId/dnd', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('upserts multiple DND preferences', async () => {
    // Two upserts + two selects
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPSERT email
      .mockResolvedValueOnce([[{ id: 1, client_id: 7, channel: 'email', opt_out: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPSERT sms
      .mockResolvedValueOnce([[{ id: 2, client_id: 7, channel: 'sms', opt_out: 0 }]]);

    const res = await request(app)
      .put('/clients/7/dnd')
      .send([
        { channel: 'email', opt_out: true, reason: 'Unsubscribed' },
        { channel: 'sms',   opt_out: false },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(db.query).toHaveBeenCalledTimes(4);
  });

  test('returns 422 when body is not an array', async () => {
    const res = await request(app)
      .put('/clients/7/dnd')
      .send({ channel: 'email', opt_out: true });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('array');
  });

  test('returns 422 for invalid channel in array item', async () => {
    const res = await request(app)
      .put('/clients/7/dnd')
      .send([{ channel: 'fax', opt_out: true }]);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 422 when opt_out is missing', async () => {
    const res = await request(app)
      .put('/clients/7/dnd')
      .send([{ channel: 'email' }]);

    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// PATCH /clients/:clientId/dnd/:channel
// ---------------------------------------------------------------------------
describe('PATCH /clients/:clientId/dnd/:channel', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('upserts a single channel DND preference', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 3, client_id: 8, channel: 'whatsapp', opt_out: 1 }]]);

    const res = await request(app)
      .patch('/clients/8/dnd/whatsapp')
      .send({ opt_out: true, reason: 'Opted out via portal' });

    expect(res.status).toBe(200);
    expect(res.body.data.channel).toBe('whatsapp');
    expect(res.body.data.opt_out).toBe(1);
    const upsertCall = db.query.mock.calls[0];
    expect(upsertCall[0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(upsertCall[1]).toContain('whatsapp');
  });

  test('returns 422 when channel path param is invalid', async () => {
    const res = await request(app)
      .patch('/clients/8/dnd/fax')
      .send({ opt_out: true });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 422 when opt_out is missing from body', async () => {
    const res = await request(app)
      .patch('/clients/8/dnd/email')
      .send({});

    expect(res.status).toBe(422);
  });

  test('upserts with quiet_hours', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{
        id: 4,
        client_id: 9,
        channel: 'sms',
        opt_out: 0,
        quiet_hours_start: '22:00:00',
        quiet_hours_end: '08:00:00',
      }]]);

    const res = await request(app)
      .patch('/clients/9/dnd/sms')
      .send({ opt_out: false, quiet_hours_start: '22:00:00', quiet_hours_end: '08:00:00' });

    expect(res.status).toBe(200);
    const upsertCall = db.query.mock.calls[0];
    expect(upsertCall[1]).toContain('22:00:00');
    expect(upsertCall[1]).toContain('08:00:00');
  });
});
