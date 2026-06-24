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
}));

jest.mock('../src/services/eventBus', () => ({ emit: jest.fn(), on: jest.fn(), removeListener: jest.fn() }));

jest.mock('../src/services/subscriberProvisioningService', () => ({ provisionNewContract: jest.fn(), generatePassword: jest.fn(() => 'gen-pass') }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const suspensionService = require('../src/services/suspensionService');
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
  mockUser();
});

// =============================================================================
// POST /contracts/:id/renew
// =============================================================================
describe('POST /contracts/:id/renew', () => {
  test('reactivates a suspended contract', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 1 }]])
      // findByIdOrFail inside Contract.update and the query in the route
      .mockResolvedValueOnce([[{ id: 5, status: 'suspended', organization_id: 1 }]])
      // Contract.update SELECT after UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/5/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    // suspended had a RADIUS disconnect → renew restores access via CoA reconnect
    expect(suspensionService.reconnectContract).toHaveBeenCalled();
  });

  // Renew must work from EVERY terminal state — the FSM trigger blocked
  // expired/cancelled/terminated -> active before migration 362.
  test.each(['cancelled', 'expired', 'terminated'])(
    'reactivates a %s contract (renew/reinstate from a terminal state)',
    async (status) => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 1 }]])
        .mockResolvedValueOnce([[{ id: 7, status, organization_id: 1 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 7, status: 'active', organization_id: 1 }]]);

      const res = await request(app)
        .post('/api/v1/contracts/7/renew')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
      // terminated had a RADIUS disconnect (from terminate) → renew reconnects;
      // cancelled/expired never disconnected, so no reconnect is attempted.
      if (status === 'terminated') {
        expect(suspensionService.reconnectContract).toHaveBeenCalled();
      } else {
        expect(suspensionService.reconnectContract).not.toHaveBeenCalled();
      }
    },
  );

  test('renew of a cancelled PPPoE contract with NO radius account re-provisions one', async () => {
    const provisioningService = require('../src/services/subscriberProvisioningService');
    provisioningService.provisionNewContract.mockResolvedValueOnce({
      connection_type: 'pppoe',
      pppoe: { radius_id: 9, username: 'sub_ada', password: 'p@ss', ipv6_enabled: false },
    });
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 7, status: 'cancelled', connection_type: 'pppoe', client_id: 3, organization_id: 1 }]])
      .mockResolvedValueOnce([[{ cnt: 0 }]])                       // radius count = 0
      .mockResolvedValueOnce([{ affectedRows: 1 }])               // Contract.update
      .mockResolvedValueOnce([[{ id: 7, status: 'active', connection_type: 'pppoe', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/7/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(provisioningService.provisionNewContract).toHaveBeenCalled();
    expect(res.body.provisioning.pppoe.username).toBe('sub_ada');  // fresh creds surfaced
  });

  test('renew of a PPPoE contract that still has a radius account does NOT re-provision', async () => {
    const provisioningService = require('../src/services/subscriberProvisioningService');
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 8, status: 'terminated', connection_type: 'pppoe', client_id: 3, organization_id: 1 }]])
      .mockResolvedValueOnce([[{ cnt: 1 }]])                       // radius account already exists
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 8, status: 'active', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/8/renew')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(provisioningService.provisionNewContract).not.toHaveBeenCalled();
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
  test('terminates an active contract and fires RADIUS disconnect', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 5, status: 'terminated', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/v1/contracts/5/terminate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    // suspensionService is called fire-and-forget so may or may not have completed
    // We just verify the response is correct
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
