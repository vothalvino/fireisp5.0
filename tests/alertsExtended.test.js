'use strict';
const request = require('supertest');
const app = require('../src/app');
jest.mock('../src/config/database');
const db = require('../src/config/database');
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organization_id: 1, role: 'admin' };
    next();
  },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

describe('Alert extended routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /api/v1/alerts/escalation-chains', () => {
    it('returns 200', async () => {
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);
      const res = await request(app).get('/api/v1/alerts/escalation-chains').set('X-Org-Id', '1');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/alerts/escalation-chains', () => {
    it('returns 201', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[{ id: 1, name: 'test' }]]);
      const res = await request(app).post('/api/v1/alerts/escalation-chains')
        .set('X-Org-Id', '1')
        .send({ name: 'Test Chain' });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/v1/alerts/maintenance-windows', () => {
    it('returns 200', async () => {
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);
      const res = await request(app).get('/api/v1/alerts/maintenance-windows').set('X-Org-Id', '1');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/alerts/maintenance-windows', () => {
    it('returns 201', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[{ id: 1, name: 'test window' }]]);
      const res = await request(app).post('/api/v1/alerts/maintenance-windows')
        .set('X-Org-Id', '1')
        .send({ name: 'Test Window', starts_at: '2026-06-11T10:00:00', ends_at: '2026-06-11T12:00:00' });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/v1/alerts/notification-channels', () => {
    it('returns 200 without config_encrypted', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'email', channel_type: 'email', is_enabled: 1 }]])
        .mockResolvedValueOnce([[{ total: 1 }]]);
      const res = await request(app).get('/api/v1/alerts/notification-channels').set('X-Org-Id', '1');
      expect(res.status).toBe(200);
      if (res.body.data && res.body.data[0]) {
        expect(res.body.data[0].config_encrypted).toBeUndefined();
      }
    });
  });

  describe('POST /api/v1/alerts/notification-channels', () => {
    it('returns 201', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[{ id: 1, name: 'email channel', channel_type: 'email', is_enabled: 1 }]]);
      const res = await request(app).post('/api/v1/alerts/notification-channels')
        .set('X-Org-Id', '1')
        .send({ name: 'Email Channel', channel_type: 'email', config: { smtp_host: 'localhost' } });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/v1/alerts/suppression-rules', () => {
    it('returns 200', async () => {
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);
      const res = await request(app).get('/api/v1/alerts/suppression-rules').set('X-Org-Id', '1');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/alerts/suppression-rules', () => {
    it('returns 201', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[{ id: 1, name: 'test rule' }]]);
      const res = await request(app).post('/api/v1/alerts/suppression-rules')
        .set('X-Org-Id', '1')
        .send({ name: 'Test Rule' });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/v1/alerts/maintenance-windows/active', () => {
    it('returns 200', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const res = await request(app).get('/api/v1/alerts/maintenance-windows/active').set('X-Org-Id', '1');
      expect(res.status).toBe(200);
    });
  });
});
