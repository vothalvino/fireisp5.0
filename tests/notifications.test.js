// =============================================================================
// FireISP 5.0 — Staff in-app notification routes + work-order assignment emits
// =============================================================================
// /notifications is a personal resource: every query is scoped to the
// authenticated user's id — no permission gate, no cross-user access.
// Work-order create/update emit 'work_order.assigned' only when the assignee
// actually changes to a user.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/auditLog', () => ({ log: jest.fn() }));
jest.mock('../src/services/eventBus', () => ({
  on: jest.fn(),
  emit: jest.fn().mockResolvedValue(undefined),
  removeAllListeners: jest.fn(),
  listenerCount: jest.fn().mockReturnValue(0),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const eventBus = require('../src/services/eventBus');
const app = require('../src/app');

const token = jwt.sign(
  { sub: 7, email: 'tech@example.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 7,
    email: 'tech@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
  User.hasEffectivePermission.mockResolvedValue(true);
}

beforeEach(() => {
  jest.resetAllMocks();
  eventBus.emit.mockResolvedValue(undefined);
  mockAuthUser();
});

// ---------------------------------------------------------------------------
// Notification routes
// ---------------------------------------------------------------------------
describe('GET /api/notifications', () => {
  test('lists only the authenticated user rows with the unread meta', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, user_id: 7, title: 'Work order assigned: X', is_read: 0 }]])
      .mockResolvedValueOnce([[{ unread: 3 }]]);
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.unread).toBe(3);
    const [sql, params] = db.query.mock.calls.find(([s]) => /FROM notifications/.test(s));
    expect(sql).toMatch(/user_id = \?/);
    expect(params).toEqual([7]);
  });

  test('unread=true adds the is_read filter', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ unread: 0 }]]);
    const res = await request(app)
      .get('/api/notifications?unread=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/is_read = 0/);
  });
});

describe('unread-count / mark read', () => {
  test('GET /api/notifications/unread-count', async () => {
    db.query.mockResolvedValueOnce([[{ count: 5 }]]);
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(5);
  });

  test('POST /:id/read marks own row, 404s otherwise', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const ok = await request(app)
      .post('/api/notifications/12/read')
      .set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/user_id = \?/);
    expect(params).toEqual(['12', 7]);

    db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const notMine = await request(app)
      .post('/api/notifications/999/read')
      .set('Authorization', `Bearer ${token}`);
    expect(notMine.status).toBe(404);
  });

  test('POST /read-all marks everything unread for the user', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 4 }]);
    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// work_order.assigned emits
// ---------------------------------------------------------------------------
describe('work-order assignment emits', () => {
  test('POST with an assignee emits work_order.assigned', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 42 }]) // INSERT
      .mockResolvedValueOnce([[{ id: 42, assigned_to: 9, title: 'Tower fix' }]]); // fresh row
    const res = await request(app)
      .post('/api/work-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tower fix', site_id: 3, assigned_to: 9, work_type: 'maintenance' });
    expect(res.status).toBe(201);
    expect(eventBus.emit).toHaveBeenCalledWith('work_order.assigned', expect.objectContaining({
      organizationId: 1,
      workOrder: expect.objectContaining({ id: 42, assigned_to: 9 }),
    }));
  });

  test('POST without an assignee emits nothing', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 43 }])
      .mockResolvedValueOnce([[{ id: 43, assigned_to: null, title: 'Unassigned' }]]);
    const res = await request(app)
      .post('/api/work-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Unassigned', site_id: 3 });
    expect(res.status).toBe(201);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test('PUT that changes the assignee emits; PUT keeping it does not', async () => {
    // change: before 5 → after 9
    db.query
      .mockResolvedValueOnce([[{ assigned_to: 5 }]]) // before
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[{ id: 42, assigned_to: 9, title: 'Tower fix' }]]); // fresh
    const changed = await request(app)
      .put('/api/work-orders/42')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tower fix', site_id: 3, assigned_to: 9, status: 'assigned', priority: 'high' });
    expect(changed.status).toBe(200);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockAuthUser();
    // unchanged: before 9 → after 9
    db.query
      .mockResolvedValueOnce([[{ assigned_to: 9 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 42, assigned_to: 9, title: 'Tower fix' }]]);
    const same = await request(app)
      .put('/api/work-orders/42')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tower fix', site_id: 3, assigned_to: 9, status: 'assigned', priority: 'high' });
    expect(same.status).toBe(200);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test('PATCH assigning a technician emits once', async () => {
    db.query
      .mockResolvedValueOnce([[{ assigned_to: null }]]) // before
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[{ id: 42, assigned_to: 9, title: 'Tower fix' }]]);
    const res = await request(app)
      .patch('/api/work-orders/42')
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_to: 9 });
    expect(res.status).toBe(200);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });
});
