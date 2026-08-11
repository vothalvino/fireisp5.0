// =============================================================================
// FireISP 5.0 — Contract lifecycle route tests (renew + terminate) — §1.2
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/suspensionService', () => ({
  suspendContract: jest.fn().mockResolvedValue(undefined),
  reconnectContract: jest.fn().mockResolvedValue(undefined),
  sendRadiusDisconnect: jest.fn().mockResolvedValue({ sent: false, response: 'mocked' }),
}));

jest.mock('../src/services/eventBus', () => ({ emit: jest.fn(), on: jest.fn(), removeListener: jest.fn() }));

jest.mock('../src/services/subscriberProvisioningService', () => ({
  provisionNewContract: jest.fn(),
  generatePassword: jest.fn(() => 'gen-pass'),
  isPppoe: jest.fn(type => ['pppoe', 'pppoe_dual'].includes(type)),
}));
jest.mock('../src/services/contractActivationService', () => ({
  getActivationState: jest.fn(),
  prepareActivation: jest.fn(),
  activate: jest.fn(),
  retryNetworkActivation: jest.fn(),
  renewPreviouslyActivated: jest.fn(),
}));

// Inventory Phase 3 (migration 391) — terminate/cancel auto-create a pickup
// work order for outstanding rented equipment. Whole-module-mocked so these
// route tests assert the WIRING (the hook fires with the right contract id)
// without re-testing ensurePickupWorkOrder's own idempotency/query logic,
// which is covered exhaustively in tests/inventorySerialService.test.js.
jest.mock('../src/services/inventorySerialService', () => ({
  ensurePickupWorkOrder: jest.fn().mockResolvedValue(null),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const suspensionService = require('../src/services/suspensionService');
const testWindowService = require('../src/services/testWindowService');
const routerProvisioningService = require('../src/services/routerProvisioningService');
const Nas = require('../src/models/Nas');
const inventorySerialService = require('../src/services/inventorySerialService');
const contractActivationService = require('../src/services/contractActivationService');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 1 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function mockUser() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 1 }]]);
    }
    return Promise.resolve([[]]);
  });
}

const token = adminToken();

beforeEach(() => {
  jest.clearAllMocks();
  // Renewal now performs its transactional DB work behind a service boundary,
  // so legacy route fixtures may leave unused one-shot results. Reset the
  // queue explicitly to prevent those values becoming the next test's auth
  // user lookup.
  db.query.mockReset();
  mockUser();
  contractActivationService.renewPreviouslyActivated.mockImplementation(async (id, options) => ({
    contract: {
      id: Number(id), organization_id: options.orgId, status: 'active',
      ...(options.endDate !== undefined ? { end_date: options.endDate } : {}),
      ...(options.planId !== undefined ? { plan_id: options.planId } : {}),
    },
    provisioning: null,
    network_activation: null,
  }));
});
afterEach(() => jest.restoreAllMocks());

// =============================================================================
// POST /contracts/:id/renew
// =============================================================================
describe('POST /contracts/:id/renew', () => {
  test('reactivates a suspended contract', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 1 }]])
      // findByIdOrFail inside Contract.update and the query in the route
      .mockResolvedValueOnce([[{ id: 5, status: 'suspended', organization_id: 1,
        first_activated_at: '2025-01-01 00:00:00' }]])
      // Contract.update SELECT after UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/5/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(contractActivationService.renewPreviouslyActivated).toHaveBeenCalledWith(5, {
      orgId: 1, endDate: undefined, planId: undefined,
    });
    // Renewal restores access transactionally; the suspended-only reconnect
    // helper must not be fired after the contract is already active.
    expect(suspensionService.reconnectContract).not.toHaveBeenCalled();
  });

  // Renew must work from EVERY terminal state — the FSM trigger blocked
  // expired/cancelled/terminated -> active before migration 362.
  test.each(['cancelled', 'expired', 'terminated'])(
    'reactivates a %s contract (renew/reinstate from a terminal state)',
    async (status) => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 1 }]])
        .mockResolvedValueOnce([[{ id: 7, status, organization_id: 1,
          first_activated_at: '2025-01-01 00:00:00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 7, status: 'active', organization_id: 1 }]]);

      const res = await request(app)
        .post('/api/v1/contracts/7/renew')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
      expect(contractActivationService.renewPreviouslyActivated).toHaveBeenCalledWith(7, {
        orgId: 1, endDate: undefined, planId: undefined,
      });
      expect(suspensionService.reconnectContract).not.toHaveBeenCalled();
    },
  );

  test('renew of a cancelled PPPoE contract with NO radius account re-provisions one', async () => {
    const provisioningService = require('../src/services/subscriberProvisioningService');
    provisioningService.provisionNewContract.mockResolvedValueOnce({
      connection_type: 'pppoe',
      pppoe: { radius_id: 9, username: 'sub_ada', password: 'p@ss', ipv6_enabled: false },
    });
    contractActivationService.renewPreviouslyActivated.mockResolvedValueOnce({
      contract: { id: 7, status: 'active', connection_type: 'pppoe', organization_id: 1 },
      provisioning: {
        connection_type: 'pppoe',
        pppoe: { radius_id: 9, username: 'sub_ada', password: 'p@ss', ipv6_enabled: false },
      },
      network_activation: {
        contract_id: 7, radius_id: 9, nas_id: null, radius_synced: true, nas_pushed: false,
      },
    });
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 7, status: 'cancelled', connection_type: 'pppoe',
        client_id: 3, organization_id: 1, first_activated_at: '2025-01-01 00:00:00' }]])
      .mockResolvedValueOnce([[{ cnt: 0 }]])                       // radius count = 0
      .mockResolvedValueOnce([{ affectedRows: 1 }])               // Contract.update
      .mockResolvedValueOnce([[{ id: 7, status: 'active', connection_type: 'pppoe', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/7/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(contractActivationService.renewPreviouslyActivated).toHaveBeenCalled();
    expect(res.body.provisioning.pppoe.username).toBe('sub_ada');  // fresh creds surfaced
    expect(res.body.network_activation).toEqual(expect.objectContaining({
      radius_id: 9, radius_synced: true,
    }));
  });

  test('renew of a PPPoE contract that still has a radius account does NOT re-provision, but reactivates it', async () => {
    const provisioningService = require('../src/services/subscriberProvisioningService');
    contractActivationService.renewPreviouslyActivated.mockResolvedValueOnce({
      contract: { id: 8, status: 'active', connection_type: 'pppoe', organization_id: 1 },
      provisioning: null,
      network_activation: {
        contract_id: 8, radius_id: 21, nas_id: 4, radius_synced: true, nas_pushed: true,
      },
    });
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 8, status: 'terminated', connection_type: 'pppoe',
        client_id: 3, organization_id: 1, first_activated_at: '2025-01-01 00:00:00' }]])
      .mockResolvedValueOnce([[{ cnt: 1 }]])                       // radius account already exists
      .mockResolvedValueOnce([{ affectedRows: 1 }])                // Bug 2 companion fix: reactivate inactive radius row
      .mockResolvedValueOnce([{ affectedRows: 1 }])                // Contract.update UPDATE
      .mockResolvedValueOnce([[{ id: 8, status: 'active', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/8/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(provisioningService.provisionNewContract).not.toHaveBeenCalled();

    expect(contractActivationService.renewPreviouslyActivated).toHaveBeenCalledWith(8, {
      orgId: 1, endDate: undefined, planId: undefined,
    });
    expect(res.body.network_activation).toEqual(expect.objectContaining({
      radius_id: 21, radius_synced: true, nas_pushed: true,
    }));
  });

  test('a never-activated cancelled contract reopens pending instead of bypassing activation', async () => {
    const cleanup = jest.spyOn(testWindowService, 'cleanupMarkedWindow').mockResolvedValue({
      contract_id: 9, closed: true, nas_disabled: true,
    });
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[
        {
          id: 9, status: 'cancelled', connection_type: 'static', client_id: 3,
          plan_id: 2, organization_id: 1, first_activated_at: null,
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // guarded terminal -> pending
      .mockResolvedValueOnce([[
        {
          id: 9, status: 'pending', connection_type: 'static', client_id: 3,
          plan_id: 2, organization_id: 1, first_activated_at: null,
        },
      ]]);

    const res = await request(app)
      .post('/api/v1/contracts/9/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      id: 9, status: 'pending', activation_required: true,
    }));
    expect(res.body.activation_required).toBe(true);
    expect(cleanup).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /UPDATE radius/.test(String(sql)))).toBe(false);
    const reset = db.query.mock.calls.find(([sql]) => /UPDATE contracts SET/.test(String(sql)));
    expect(reset[0]).toMatch(/test_window_expires_at = NULL/);
    expect(reset[0]).toMatch(/test_window_cleanup_pending = 0/);
  });

  test('a no-marker legacy PPPoE renewal performs shutdown before reopening pending', async () => {
    const cleanup = jest.spyOn(testWindowService, 'cleanupMarkedWindow').mockResolvedValue({
      contract_id: 10, closed: true, nas_disabled: true, disconnect_confirmed: true,
    });
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[
        {
          id: 10, status: 'cancelled', connection_type: 'pppoe', client_id: 3,
          plan_id: 2, organization_id: 1, first_activated_at: null,
          test_window_expires_at: null, test_window_cleanup_pending: 0,
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // radius inactive
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // guarded terminal -> pending
      .mockResolvedValueOnce([[
        {
          id: 10, status: 'pending', connection_type: 'pppoe', client_id: 3,
          organization_id: 1, first_activated_at: null,
        },
      ]]);

    const res = await request(app)
      .post('/api/v1/contracts/10/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(cleanup).toHaveBeenCalledWith(10, {
      orgId: 1, reason: 'first_activation_reset', requireMarker: false,
    });
    const radiusOff = db.query.mock.calls.find(([sql]) => /UPDATE radius SET status = 'inactive'/.test(sql));
    const reset = db.query.mock.calls.find(([sql]) => /UPDATE contracts SET status = 'pending'/.test(sql));
    expect(radiusOff).toBeDefined();
    expect(reset[0]).not.toMatch(/test_window_cleanup_pending = 0|test_window_expires_at = NULL/);
  });

  test('returns 422 for an already active contract', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/5/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_RENEWABLE');
  });

  test('returns 404 when contract not found', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[]]); // no contract rows

    const res = await request(app)
      .post('/api/v1/contracts/999/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).post('/api/v1/contracts/5/renew').send({});
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /contracts/:id/terminate
// =============================================================================
// =============================================================================
// POST /contracts/:id/regenerate-pppoe
// =============================================================================
describe('POST /contracts/:id/regenerate-pppoe', () => {
  test('rotates the PPPoE password and returns the new credentials', async () => {
    const provisioningService = require('../src/services/subscriberProvisioningService');
    provisioningService.generatePassword.mockReturnValueOnce('fresh-secret-123');
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]]) // auth
      .mockResolvedValueOnce([[{ id: 5, connection_type: 'pppoe', organization_id: 1 }]])        // contract
      .mockResolvedValueOnce([[{ id: 99, username: 'sub_ada', password: 'old', nas_id: null }]]) // radius account
      .mockResolvedValueOnce([{ affectedRows: 1 }]);                                             // UPDATE radius

    const res = await request(app)
      .post('/api/v1/contracts/5/regenerate-pppoe')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('sub_ada');
    expect(res.body.data.password).toBe('fresh-secret-123');
  });

  test('returns 422 for a non-PPPoE contract', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 5, connection_type: 'ipoe', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/5/regenerate-pppoe')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_PPPOE');
  });

  test('pending credential rotation never pushes an unbounded local RouterOS secret', async () => {
    const provisioningService = require('../src/services/subscriberProvisioningService');
    provisioningService.generatePassword.mockReturnValueOnce('pending-secret-123');
    jest.spyOn(Nas, 'findByIdOrFail');
    jest.spyOn(routerProvisioningService, 'pushSubscriber');
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[
        {
          id: 6, status: 'pending', connection_type: 'pppoe', organization_id: 1,
        },
      ]])
      .mockResolvedValueOnce([[
        { id: 100, username: 'pending-user', password: 'old', nas_id: 12 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .post('/api/v1/contracts/6/regenerate-pppoe')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      username: 'pending-user', password: 'pending-secret-123',
    }));
    expect(res.body.pushed).toBe(false);
    expect(Nas.findByIdOrFail).not.toHaveBeenCalled();
    expect(routerProvisioningService.pushSubscriber).not.toHaveBeenCalled();
  });

  test('returns 422 when the PPPoE contract has no radius account', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 5, connection_type: 'pppoe', organization_id: 1 }]])
      .mockResolvedValueOnce([[]]); // no radius account

    const res = await request(app)
      .post('/api/v1/contracts/5/regenerate-pppoe')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_PPPOE_ACCOUNT');
  });

  test('returns 404 when the contract is not found', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/v1/contracts/999/regenerate-pppoe')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe('POST /contracts/:id/terminate', () => {
  test('terminates an active contract, deactivates RADIUS, and fires RADIUS disconnect', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 5, status: 'terminated', organization_id: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE radius -> inactive

    const res = await request(app)
      .post('/api/v1/contracts/5/terminate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);

    // Bug 2: termination is a permanent end of service — the RADIUS account
    // must be deactivated so it stops authenticating new PPPoE sessions.
    const radiusCall = db.query.mock.calls.find(
      c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
    );
    expect(radiusCall).toBeTruthy();
    expect(radiusCall[0]).toContain("'inactive'");
    expect(radiusCall[1]).toEqual(['5']);

    // Fires the best-effort CoA disconnect directly (no longer reuses
    // suspensionService.suspendContract, which incorrectly left
    // contracts.status transiently 'suspended' and logged a misleading
    // 'suspend' suspension_logs entry for what is actually a terminate).
    expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(5);

    // Inventory Phase 3 (migration 391): terminate auto-triggers the
    // equipment-pickup hook for this contract, org-scoped.
    expect(inventorySerialService.ensurePickupWorkOrder).toHaveBeenCalledWith(
      5, expect.objectContaining({ orgId: 1 }),
    );
  });

  test('returns 422 for a cancelled (non-terminable) contract', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'cancelled', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/5/terminate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_TERMINABLE');
  });

  test('returns 404 when contract not found', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[]]); // no rows

    const res = await request(app)
      .post('/api/v1/contracts/999/terminate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });

  test('terminates a suspended contract', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'suspended', organization_id: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 5, status: 'terminated', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/5/terminate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
  });
});
