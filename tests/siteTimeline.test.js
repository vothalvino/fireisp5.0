// =============================================================================
// FireISP 5.0 — Site timeline + work-order audit logging
// =============================================================================
// /sites/:id/timeline merges work orders, outages and maintenance windows for
// one site (the "what happened to tower X" view); work-order mutations now
// write audit_log rows like every crudController resource.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
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
const auditLog = require('../src/services/auditLog');
const app = require('../src/app');

const token = jwt.sign(
  { sub: 1, email: 'ops@example.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

beforeEach(() => {
  jest.resetAllMocks();
  auditLog.log.mockResolvedValue(undefined);
  User.findById.mockResolvedValue({ id: 1, email: 'ops@example.com', status: 'active', role: 'admin', organization_id: 1 });
  User.hasEffectivePermission.mockResolvedValue(true);
});

describe('GET /api/sites/:id/timeline', () => {
  test('merges work orders, outages and maintenance windows newest-first', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 3, name: 'Tower North' }]]) // site org check
      .mockResolvedValueOnce([[
        { event_type: 'work_order', id: 42, title: 'Replace radio', subtype: 'maintenance', status: 'completed', assigned_to: 9, occurred_at: '2026-07-15' },
        { event_type: 'maintenance_window', id: 7, title: 'Radio swap window', subtype: null, status: 'completed', assigned_to: null, occurred_at: '2026-07-15' },
        { event_type: 'outage', id: 5, title: 'Planned downtime', subtype: 'planned', status: 'resolved', assigned_to: null, occurred_at: '2026-07-15' },
      ]]);
    const res = await request(app)
      .get('/api/sites/3/timeline')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.site_name).toBe('Tower North');
    expect(res.body.data.events).toHaveLength(3);
    const [sql] = db.query.mock.calls[1];
    expect(sql).toMatch(/FROM work_orders/);
    expect(sql).toMatch(/FROM outages/);
    expect(sql).toMatch(/FROM maintenance_windows/);
    expect(sql).toMatch(/ORDER BY occurred_at DESC/);
  });

  test('404s for a site outside the org', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .get('/api/sites/999/timeline')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('work-order mutations write audit_log rows', () => {
  test('POST logs a create entry', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 42 }])
      .mockResolvedValueOnce([[{ id: 42, assigned_to: null, title: 'Tower fix' }]]);
    const res = await request(app)
      .post('/api/work-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tower fix', site_id: 3, work_type: 'maintenance' });
    expect(res.status).toBe(201);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', tableName: 'work_orders', recordId: 42, organizationId: 1,
    }));
  });

  test('PATCH logs an update entry with the old snapshot', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 42, assigned_to: null, status: 'pending', client_id: null, site_id: 3, device_id: null }]]) // before
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 42, assigned_to: null, status: 'in_progress' }]]);
    const res = await request(app)
      .patch('/api/work-orders/42')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update', tableName: 'work_orders', recordId: 42,
      oldValues: expect.objectContaining({ status: 'pending' }),
      newValues: { status: 'in_progress' },
    }));
  });

  test('DELETE logs a delete entry', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app)
      .delete('/api/work-orders/42')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delete', tableName: 'work_orders', recordId: 42,
    }));
  });
});
