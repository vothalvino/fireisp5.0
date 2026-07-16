// =============================================================================
// FireISP 5.0 — Outage route event-emit wiring tests
// =============================================================================
// Covers src/routes/outages.js's crudController hooks:
//   afterCreate → emits 'outage.reported'
//   afterUpdate → emits 'outage.resolved' ONLY on the transition INTO
//     'resolved' from a different prior status (never on an unrelated edit
//     to an already-resolved outage, and never on a transition to some other
//     status like 'post_mortem').
// The downstream listener behavior (bell/email/webhook/portal-push) is
// covered separately in tests/notificationHooks.test.js — this file only
// asserts the route calls eventBus.emit with the right event/payload at the
// right time, so eventBus itself is mocked.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/eventBus', () => ({
  on: jest.fn(),
  emit: jest.fn().mockResolvedValue(undefined),
  removeAllListeners: jest.fn(),
  listenerCount: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}
const TOKEN = adminToken();

const isAuthLookup   = (s) => typeof s === 'string' && /FROM `users`/.test(s);
const isOutageInsert = (s) => typeof s === 'string' && /INSERT INTO `outages`/.test(s);
const isOutageSelect = (s) => typeof s === 'string' && /SELECT \* FROM `outages` WHERE id = \?/.test(s);
const isOutageUpdate = (s) => typeof s === 'string' && /UPDATE `outages` SET/.test(s);

const ADMIN_ROW = [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];

beforeEach(() => { jest.clearAllMocks(); });

describe('POST /outages — afterCreate emits outage.reported', () => {
  test('emits outage.reported with the created record and the request org context', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isOutageInsert(sql)) return Promise.resolve([{ insertId: 50 }]);
      if (isOutageSelect(sql)) {
        return Promise.resolve([[{ id: 50, title: 'Fiber cut', severity: 'critical', status: 'ongoing', started_at: '2026-04-13T09:00:00Z' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/outages')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ title: 'Fiber cut', severity: 'critical', started_at: '2026-04-13T09:00:00Z' });

    expect(res.status).toBe(201);
    expect(eventBus.emit).toHaveBeenCalledWith('outage.reported', expect.objectContaining({
      organizationId: 42,
      outage: expect.objectContaining({ id: 50, title: 'Fiber cut' }),
    }));
  });
});

describe('PUT /outages/:id — afterUpdate emits outage.resolved only on the transition into resolved', () => {
  test('emits outage.resolved when status transitions from ongoing to resolved', async () => {
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isOutageSelect(sql)) {
        // findByIdOrFail (pre-update) is called first, then findById (post-update)
        // after Model.update() — both hit the same SELECT shape; return the
        // CURRENT row each time the mock is consulted, so we track state
        // via a closure counter to simulate the transition.
        return Promise.resolve([[db.__outageRow]]);
      }
      if (isOutageUpdate(sql)) {
        db.__outageRow = { ...db.__outageRow, status: 'resolved', resolved_at: '2026-04-13T12:00:00Z' };
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
    db.__outageRow = { id: 50, title: 'Fiber cut', status: 'ongoing' };

    const res = await request(app)
      .put('/api/v1/outages/50')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(eventBus.emit).toHaveBeenCalledWith('outage.resolved', expect.objectContaining({
      organizationId: 42,
      outage: expect.objectContaining({ id: 50, status: 'resolved' }),
    }));
  });

  test('does not re-emit outage.resolved on an unrelated edit to an already-resolved outage', async () => {
    db.__outageRow = { id: 50, title: 'Fiber cut', status: 'resolved', resolved_at: '2026-04-13T12:00:00Z' };
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isOutageSelect(sql)) return Promise.resolve([[db.__outageRow]]);
      if (isOutageUpdate(sql)) {
        db.__outageRow = { ...db.__outageRow, title: 'Fiber cut (root cause added)' };
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .put('/api/v1/outages/50')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ title: 'Fiber cut (root cause added)', status: 'resolved' });

    expect(res.status).toBe(200);
    expect(eventBus.emit).not.toHaveBeenCalledWith('outage.resolved', expect.anything());
  });

  test('does not emit outage.resolved on a transition to a different non-resolved status', async () => {
    db.__outageRow = { id: 50, title: 'Fiber cut', status: 'ongoing' };
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve(ADMIN_ROW);
      if (isOutageSelect(sql)) return Promise.resolve([[db.__outageRow]]);
      if (isOutageUpdate(sql)) {
        db.__outageRow = { ...db.__outageRow, status: 'post_mortem' };
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .put('/api/v1/outages/50')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'post_mortem' });

    expect(res.status).toBe(200);
    expect(eventBus.emit).not.toHaveBeenCalledWith('outage.resolved', expect.anything());
  });
});
