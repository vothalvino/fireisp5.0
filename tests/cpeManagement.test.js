// =============================================================================
// FireISP 5.0 — CPE Management API Tests (§8.1)
// =============================================================================
'use strict';

const request = require('supertest');
const app = require('../src/app');

jest.mock('../src/config/database', () => ({
  query:         jest.fn(),
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organization_id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

// bcryptjs mock so tests don't do real hashing
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

const db = require('../src/config/database');

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/cpe-management/devices
// ---------------------------------------------------------------------------

describe('GET /api/cpe-management/devices', () => {
  it('returns paginated CPE devices with 200', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 1,
          serial_number: 'SN001',
          oui: 'EC1724',
          manufacturer: 'TP-Link',
          model_name: 'Archer',
          status: 'active',
        },
      ]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const res = await request(app)
      .get('/api/cpe-management/devices')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].serial_number).toBe('SN001');
    expect(res.body.meta).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/cpe-management/devices
// ---------------------------------------------------------------------------

describe('POST /api/cpe-management/devices', () => {
  it('creates a CPE device and returns 201', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 5 }])
      .mockResolvedValueOnce([[{
        id: 5,
        serial_number: 'SN002',
        oui: 'AABBCC',
        manufacturer: 'ZTE',
        model_name: 'F660',
        status: 'new',
        organization_id: 1,
      }]]);

    const res = await request(app)
      .post('/api/cpe-management/devices')
      .set('Authorization', 'Bearer test')
      .send({
        serial_number: 'SN002',
        oui: 'AABBCC',
        manufacturer: 'ZTE',
        model_name: 'F660',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.serial_number).toBe('SN002');
    expect(res.body.data.manufacturer).toBe('ZTE');
  });
});

// ---------------------------------------------------------------------------
// POST /api/cpe-management/devices/:id/tasks
// ---------------------------------------------------------------------------

describe('POST /api/cpe-management/devices/:id/tasks', () => {
  it('queues a task for a CPE device and returns 201', async () => {
    // findByIdOrFail mock
    db.query
      .mockResolvedValueOnce([[{ id: 1, serial_number: 'SN001', deleted_at: null, organization_id: 1 }]])
      // CpeTask.create: insert + findByIdIncludingDeleted
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([[{
        id: 10,
        cpe_device_id: 1,
        task_type: 'reboot',
        status: 'queued',
        priority: 5,
        organization_id: 1,
      }]]);

    const res = await request(app)
      .post('/api/cpe-management/devices/1/tasks')
      .set('Authorization', 'Bearer test')
      .send({ task_type: 'reboot' });

    expect(res.status).toBe(201);
    expect(res.body.data.task_type).toBe('reboot');
    expect(res.body.data.status).toBe('queued');
  });
});

// ---------------------------------------------------------------------------
// POST /api/cpe-management/devices/batch-parameter-push
// ---------------------------------------------------------------------------

describe('POST /api/cpe-management/devices/batch-parameter-push', () => {
  it('queues set_parameter_values tasks for multiple CPEs and returns 200', async () => {
    // findById for cpe_id=1
    db.query
      .mockResolvedValueOnce([[{ id: 1, serial_number: 'SN001', deleted_at: null, organization_id: 1 }]])
      // CpeTask.create for device 1: insert + select
      .mockResolvedValueOnce([{ insertId: 20 }])
      .mockResolvedValueOnce([[{
        id: 20,
        cpe_device_id: 1,
        task_type: 'set_parameter_values',
        status: 'queued',
      }]])
      // findById for cpe_id=2
      .mockResolvedValueOnce([[{ id: 2, serial_number: 'SN002', deleted_at: null, organization_id: 1 }]])
      // CpeTask.create for device 2
      .mockResolvedValueOnce([{ insertId: 21 }])
      .mockResolvedValueOnce([[{
        id: 21,
        cpe_device_id: 2,
        task_type: 'set_parameter_values',
        status: 'queued',
      }]]);

    const res = await request(app)
      .post('/api/cpe-management/devices/batch-parameter-push')
      .set('Authorization', 'Bearer test')
      .send({
        cpe_ids: [1, 2],
        parameters: [{ name: 'Device.WiFi.SSID.1.SSID', value: 'NewSSID' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.queued).toBe(2);
  });

  it('returns 422 when cpe_ids is missing', async () => {
    const res = await request(app)
      .post('/api/cpe-management/devices/batch-parameter-push')
      .set('Authorization', 'Bearer test')
      .send({ parameters: [{ name: 'x', value: 'y' }] });

    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cpe-management/devices/:id/lifecycle/transition
// Inventory Phase 3 hardening: a manual transition across the in_stock
// boundary must be rejected for a TRACKED unit (inventory_item_id set) —
// only the install/pickup flows are allowed to move stock. Non-boundary
// transitions and non-linked units are unaffected.
// ---------------------------------------------------------------------------

describe('POST /api/cpe-management/devices/:id/lifecycle/transition', () => {
  function mockTransitionSuccess({ id, fromState, toState, inventoryItemId = null }) {
    db.query
      // CpeDevice.findByIdOrFail
      .mockResolvedValueOnce([[{ id, organization_id: 1, lifecycle_state: fromState, inventory_item_id: inventoryItemId }]])
      // transitionLifecycleState: load current state
      .mockResolvedValueOnce([[{ id, lifecycle_state: fromState, organization_id: 1 }]])
      // transitionLifecycleState: apply state
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      // transitionLifecycleState: history insert
      .mockResolvedValueOnce([{ insertId: 1 }])
      // transitionLifecycleState: final reselect
      .mockResolvedValueOnce([[{ id, lifecycle_state: toState, organization_id: 1, inventory_item_id: inventoryItemId }]]);
  }

  it('rejects a linked unit crossing OUT of in_stock (in_stock -> assigned) with 422', async () => {
    db.query.mockResolvedValueOnce([[{ id: 10, organization_id: 1, lifecycle_state: 'in_stock', inventory_item_id: 5 }]]);

    const res = await request(app)
      .post('/api/cpe-management/devices/10/lifecycle/transition')
      .set('Authorization', 'Bearer test')
      .send({ to_state: 'assigned' });

    expect(res.status).toBe(422);
    expect(db.query).toHaveBeenCalledTimes(1); // no further writes attempted
  });

  it('rejects a linked unit crossing INTO in_stock (assigned -> in_stock) with 422', async () => {
    db.query.mockResolvedValueOnce([[{ id: 10, organization_id: 1, lifecycle_state: 'assigned', inventory_item_id: 5 }]]);

    const res = await request(app)
      .post('/api/cpe-management/devices/10/lifecycle/transition')
      .set('Authorization', 'Bearer test')
      .send({ to_state: 'in_stock' });

    expect(res.status).toBe(422);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('allows a linked unit transitioning WITHOUT crossing the in_stock boundary (assigned -> active)', async () => {
    mockTransitionSuccess({ id: 10, fromState: 'assigned', toState: 'active', inventoryItemId: 5 });

    const res = await request(app)
      .post('/api/cpe-management/devices/10/lifecycle/transition')
      .set('Authorization', 'Bearer test')
      .send({ to_state: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle_state).toBe('active');
  });

  it('allows a NON-linked unit crossing the in_stock boundary (in_stock -> assigned)', async () => {
    mockTransitionSuccess({ id: 11, fromState: 'in_stock', toState: 'assigned', inventoryItemId: null });

    const res = await request(app)
      .post('/api/cpe-management/devices/11/lifecycle/transition')
      .set('Authorization', 'Bearer test')
      .send({ to_state: 'assigned' });

    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle_state).toBe('assigned');
  });
});
