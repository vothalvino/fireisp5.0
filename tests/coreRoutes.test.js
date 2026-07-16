// =============================================================================
// FireISP 5.0 — Core Route Integration Tests
// =============================================================================
// Comprehensive tests for 10 critical route groups:
//   Contracts, Invoices, Payments, Users, Devices,
//   Tickets, Plans, Organizations, Roles
// =============================================================================

// Mock the database module before requiring anything else
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// 1. CONTRACT ROUTES — /api/contracts
// =============================================================================
describe('Contract Routes — /api/contracts', () => {

  const mockContract = {
    id: 1,
    organization_id: 1,
    client_id: 10,
    plan_id: 5,
    connection_type: 'pppoe',
    start_date: '2025-01-01',
    billing_day: 1,
    price_override: null,
    ip_address: '10.0.0.1',
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/contracts', () => {
    test('returns paginated list of contracts', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])   // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);  // count

      const res = await request(app)
        .get('/api/contracts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/contracts');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/contracts/:id', () => {
    test('returns a contract by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockContract]]);

      const res = await request(app)
        .get('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.client_id).toBe(10);
    });

    test('returns 404 when contract not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/contracts/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/contracts', () => {
    test('creates a contract and returns 201', async () => {
      mockAuthUser();
      const conn = {
        query: jest.fn(),
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      conn.query
        .mockResolvedValueOnce([[{ id: 5 }]])                       // assertPlanSelectable — plan 5 is live
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])  // INSERT contracts
        .mockResolvedValueOnce([[{ name: 'Acme' }]]);               // SELECT client name (seed)
      db.getConnection.mockResolvedValue(conn);
      db.query
        .mockResolvedValueOnce([[{ id: 10 }]])                        // Client.findById — in-org
        .mockResolvedValueOnce([[{ ...mockContract, id: 2 }]])       // Contract.findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);               // auditLog

      const res = await request(app)
        .post('/api/contracts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, plan_id: 5, start_date: '2025-01-01' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });

    test('rejects creating a contract on an archived plan with 422 PLAN_ARCHIVED', async () => {
      mockAuthUser();
      const conn = {
        query: jest.fn().mockResolvedValueOnce([[]]), // assertPlanSelectable — plan archived/missing
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      db.getConnection.mockResolvedValue(conn);

      const res = await request(app)
        .post('/api/contracts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, plan_id: 5, start_date: '2025-01-01' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PLAN_ARCHIVED');
      expect(conn.rollback).toHaveBeenCalled();
    });

    // Bug 1 (security hardening): assertPlanSelectable must scope the plan
    // lookup to this org (or a global plan) — previously it only checked
    // id + deleted_at IS NULL, so an org-A admin could create a contract on
    // org B's plan.
    test('scopes the plan lookup to this organization (or a global plan)', async () => {
      mockAuthUser();
      const conn = {
        query: jest.fn(),
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      conn.query
        .mockResolvedValueOnce([[{ id: 5 }]])                       // assertPlanSelectable — plan 5 is live and in-org/global
        .mockResolvedValueOnce([{ insertId: 3, affectedRows: 1 }])  // INSERT contracts
        .mockResolvedValueOnce([[{ name: 'Acme' }]]);               // SELECT client name (seed)
      db.getConnection.mockResolvedValue(conn);
      db.query
        .mockResolvedValueOnce([[{ id: 10 }]])                        // Client.findById — in-org
        .mockResolvedValueOnce([[{ ...mockContract, id: 3 }]])       // Contract.findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);               // auditLog

      const res = await request(app)
        .post('/api/contracts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, plan_id: 5, start_date: '2025-01-01' });

      expect(res.status).toBe(201);
      const planQuery = conn.query.mock.calls[0];
      expect(planQuery[0]).toContain('organization_id = ?');
      expect(planQuery[0]).toContain('organization_id IS NULL');
      expect(planQuery[1]).toEqual([5, 1]); // [planId, orgId] — authToken's orgId is 1
    });

    test('rejects a plan that belongs to a different organization with 422 PLAN_ARCHIVED', async () => {
      mockAuthUser();
      const conn = {
        // The org-scoped query returns no rows — the plan exists but is owned
        // by a DIFFERENT organization (not archived); assertPlanSelectable
        // can't (and needn't) distinguish the two cases, both correctly
        // reject the create the same way.
        query: jest.fn().mockResolvedValueOnce([[]]),
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      db.getConnection.mockResolvedValue(conn);

      const res = await request(app)
        .post('/api/contracts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, plan_id: 999, start_date: '2025-01-01' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PLAN_ARCHIVED');
      expect(conn.query.mock.calls[0][1]).toEqual([999, 1]);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/contracts/:id', () => {
    test('updates a contract', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])                                    // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                              // UPDATE
        .mockResolvedValueOnce([[{ ...mockContract, status: 'suspended' }]]);      // findById (inside Contract.update)

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('suspended');
    });

    // Migration 388 — configurable diagnostic thresholds: the 3 per-contract
    // override columns must be on Contract.fillable (or BaseModel.update
    // silently drops them) and the validation schema (or validate() 422s).
    test('PUT persists the 3 migration-388 threshold override fields (optical_min_dbm, wireless_signal_min_dbm, wireless_link_capacity_min_mbps)', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])                              // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE contracts
        .mockResolvedValueOnce([[{                                            // findById (inside Contract.update)
          ...mockContract,
          optical_min_dbm: -30, wireless_signal_min_dbm: -68, wireless_link_capacity_min_mbps: '15.00',
        }]]);

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ optical_min_dbm: -30, wireless_signal_min_dbm: -68, wireless_link_capacity_min_mbps: 15 });

      expect(res.status).toBe(200);
      const updateCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].startsWith('UPDATE `contracts`'),
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall[0]).toContain('`optical_min_dbm` = ?');
      expect(updateCall[0]).toContain('`wireless_signal_min_dbm` = ?');
      expect(updateCall[0]).toContain('`wireless_link_capacity_min_mbps` = ?');
      expect(updateCall[1]).toEqual(expect.arrayContaining([-30, -68, 15]));
      expect(res.body.data.optical_min_dbm).toBe(-30);
      expect(res.body.data.wireless_signal_min_dbm).toBe(-68);
    });

    // Out-of-bounds values must 422 via validate(), never silently clamp or
    // reach the model layer.
    test('PUT rejects an out-of-range wireless_link_capacity_min_mbps (> 10000) with 422, no UPDATE issued', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockContract]]); // findByIdOrFail

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ wireless_link_capacity_min_mbps: 20000 });

      expect(res.status).toBe(422);
      const updateCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].startsWith('UPDATE `contracts`'),
      );
      expect(updateCall).toBeUndefined();
    });

    // Adversarial-review finding (HIGH, confirmed 2/2): the Edit Contract
    // modal (ContractList.tsx EDIT_STATUSES) always PUTs a `status` field and
    // legally drives active<->suspended — the FSM trigger permits both, and
    // this route's own schema enum allows them. updateContractHandler's
    // radius sync originally only covered terminated/cancelled/expired, so
    // an Edit-modal suspend left radius 'active' (cosmetic suspend — the
    // subscriber just re-dials) and an Edit-modal reactivation left radius
    // 'suspended' (service dead despite contracts.status='active').
    test('Edit-modal suspend (active -> suspended via PUT) deactivates the RADIUS account (Case A)', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])                              // findByIdOrFail (status: active)
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE contracts
        .mockResolvedValueOnce([[{ ...mockContract, status: 'suspended' }]])  // findById (inside Contract.update)
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                       // UPDATE radius -> suspended

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(200);
      const radiusCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
      );
      expect(radiusCall).toBeTruthy();
      expect(radiusCall[0]).toContain("'suspended'");
      expect(radiusCall[0]).toContain("status = 'active'");
      expect(radiusCall[1]).toEqual([1]);
    });

    test('Edit-modal reactivation (suspended -> active via PUT) reactivates the RADIUS account (Case B)', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ ...mockContract, status: 'suspended' }]])  // findByIdOrFail (status: suspended)
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE contracts
        .mockResolvedValueOnce([[{ ...mockContract, status: 'active' }]])     // findById (inside Contract.update)
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                       // UPDATE radius -> active

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      const radiusCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
      );
      expect(radiusCall).toBeTruthy();
      expect(radiusCall[0]).toContain("'active'");
      expect(radiusCall[0]).toContain("IN ('suspended', 'inactive')");
      expect(radiusCall[1]).toEqual([1]);
    });

    test('Edit-modal reactivation from a terminated contract (terminal -> active via PUT) reactivates RADIUS too', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ ...mockContract, status: 'terminated' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockContract, status: 'active' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      const radiusCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
      );
      expect(radiusCall).toBeTruthy();
      expect(radiusCall[0]).toContain("'active'");
      expect(radiusCall[1]).toEqual([1]);

      // Adversarial-review finding (medium, confirmed): a terminated contract
      // reactivated via the Edit modal was never actually "suspended", so it
      // must not get a phantom 'unsuspended' suspension_logs row either.
      const logCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('INSERT INTO suspension_logs'),
      );
      expect(logCall).toBeUndefined();
    });

    // Adversarial-review finding (medium, confirmed): the FSM also allows
    // pending -> active — a brand-new contract's ORDINARY first activation
    // via the Edit modal, the single most common path through this branch.
    // old.status !== 'suspended' here, so this must sync radius exactly like
    // any other ->active transition but must NOT write a suspension_logs
    // row — the contract was never suspended, so logging 'unsuspended' with
    // suspended_at=NOW()/restored_at=NOW() would be a phantom
    // zero-duration suspension polluting the audit/compliance table.
    test('pending -> active via PUT reactivates RADIUS but writes NO suspension_logs row', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ ...mockContract, status: 'pending' }]])  // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                       // UPDATE contracts
        .mockResolvedValueOnce([[{ ...mockContract, status: 'active' }]])   // findById (inside Contract.update)
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                      // UPDATE radius -> active

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      const radiusCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
      );
      expect(radiusCall).toBeTruthy();
      expect(radiusCall[0]).toContain("'active'");
      expect(radiusCall[0]).toContain("IN ('suspended', 'inactive')");

      const logCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('INSERT INTO suspension_logs'),
      );
      expect(logCall).toBeUndefined();
      const closeCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('UPDATE suspension_logs SET restored_at'),
      );
      expect(closeCall).toBeUndefined();
    });

    // Migration-384-era hardening: the generic PUT/PATCH status toggle now
    // writes the same suspension_logs audit row the dedicated /suspend and
    // /unsuspend routes write (suspensionService.suspendContract/
    // reconnectContract), closing the audit-trail hole the Edit-modal path
    // used to leave.
    test('Edit-modal suspend (active -> suspended via PUT) also writes a suspension_logs row', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])                              // findByIdOrFail (status: active)
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE contracts
        .mockResolvedValueOnce([[{ ...mockContract, status: 'suspended' }]])  // findById (inside Contract.update)
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE radius -> suspended
        .mockResolvedValueOnce([[]])                                          // sendRadiusDisconnect: no RADIUS account (awaited)
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                       // INSERT suspension_logs

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'suspended' });

      expect(res.status).toBe(200);
      const logCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('INSERT INTO suspension_logs'),
      );
      expect(logCall).toBeTruthy();
      expect(logCall[0]).toContain("'suspended'");
    });

    test('Edit-modal reactivation (suspended -> active via PUT) writes an \'unsuspended\' suspension_logs row and closes any open prior row', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ ...mockContract, status: 'suspended' }]])  // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE contracts
        .mockResolvedValueOnce([[{ ...mockContract, status: 'active' }]])     // findById (inside Contract.update)
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE radius -> active
        .mockResolvedValueOnce([[]])                                          // sendRadiusCoA: no RADIUS account (awaited)
        .mockResolvedValueOnce([[{ suspended_at: new Date('2026-07-01T00:00:00Z') }]])  // closeOpenSuspensionAndGetStart SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // closeOpenSuspensionAndGetStart UPDATE close
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                       // INSERT suspension_logs

      const res = await request(app)
        .put('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      const closeCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('UPDATE suspension_logs SET restored_at'),
      );
      expect(closeCall).toBeTruthy();
      const logCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('INSERT INTO suspension_logs'),
      );
      expect(logCall).toBeTruthy();
      expect(logCall[0]).toContain("'unsuspended'");
    });
  });

  // Bug 2 (security hardening): a direct PATCH {status:'cancelled'} — the
  // frontend's own Cancel action (ContractList.tsx patchContractStatus) —
  // bypasses the dedicated /terminate route entirely, so updateContractHandler
  // must deactivate any RADIUS account itself or the cancelled subscriber's
  // PPPoE credentials would keep authenticating.
  describe('PATCH /api/contracts/:id — RADIUS sync on a direct status change', () => {
    test('deactivates the RADIUS account when the status changes to cancelled', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])                              // findByIdOrFail (status: active)
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE contracts
        .mockResolvedValueOnce([[{ ...mockContract, status: 'cancelled' }]])  // findById (inside Contract.update)
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                       // UPDATE radius -> inactive

      const res = await request(app)
        .patch('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'cancelled' });

      expect(res.status).toBe(200);
      const radiusCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
      );
      expect(radiusCall).toBeTruthy();
      expect(radiusCall[0]).toContain("'inactive'");
      expect(radiusCall[1]).toEqual([1]);

      // Terminal transitions stay log-free — no 'terminated'/'cancelled'
      // value exists in suspension_logs.action, matching the deliberate
      // decision already made for POST /:id/terminate.
      const logCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].includes('INSERT INTO suspension_logs'),
      );
      expect(logCall).toBeUndefined();
    });

    test('does not touch RADIUS when the status is not actually changing', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ ...mockContract, status: 'cancelled' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockContract, status: 'cancelled' }]]);

      const res = await request(app)
        .patch('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'cancelled', price_override: 199.99 });

      expect(res.status).toBe(200);
      const radiusCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
      );
      expect(radiusCall).toBeUndefined();
    });

    test('does not touch RADIUS on an unrelated field update', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockContract, billing_day: 15 }]]);

      const res = await request(app)
        .patch('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ billing_day: 15 });

      expect(res.status).toBe(200);
      const radiusCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /UPDATE radius SET status/.test(c[0]),
      );
      expect(radiusCall).toBeUndefined();
    });

    // Migration 387: the two per-contract AI-diagnostic escalation toggles
    // (see diagnosticEngineService.js's ESCALATE_WHEN-equivalent contract-
    // aware logic) must actually persist through the generic PATCH handler —
    // both are on Contract.fillable and the patchContract validation schema.
    test('persists escalation_enabled and escalate_on_disconnect', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])                                  // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                            // UPDATE contracts
        .mockResolvedValueOnce([[{                                                // findById (inside Contract.update)
          ...mockContract, escalation_enabled: 0, escalate_on_disconnect: 1,
        }]]);

      const res = await request(app)
        .patch('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ escalation_enabled: false, escalate_on_disconnect: true });

      expect(res.status).toBe(200);
      expect(res.body.data.escalation_enabled).toBe(0);
      expect(res.body.data.escalate_on_disconnect).toBe(1);

      const updateCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && /^UPDATE `?contracts`?\b/.test(c[0]),
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall[0]).toContain('escalation_enabled');
      expect(updateCall[0]).toContain('escalate_on_disconnect');
      // validate() coerces JSON booleans through as booleans; MySQL itself
      // round-trips them as 0/1 (see CLAUDE.md — not something to "fix").
      expect(updateCall[1]).toEqual(expect.arrayContaining([false, true]));
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/contracts/:id', () => {
    test('deletes a contract and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockContract]])       // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // soft-DELETE (UPDATE deleted_at)

      const res = await request(app)
        .delete('/api/contracts/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /:id/addons ---
  describe('GET /api/contracts/:id/addons', () => {
    test('returns add-ons for a contract', async () => {
      mockAuthUser();
      const addon = { id: 1, contract_id: 1, plan_addon_id: 3, addon_name: 'Static IP', addon_type: 'static_ip', quantity: 1 };
      db.query.mockResolvedValueOnce([[addon]]);

      const res = await request(app)
        .get('/api/contracts/1/addons')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].addon_name).toBe('Static IP');
    });
  });

  // --- POST /:id/addons ---
  describe('POST /api/contracts/:id/addons', () => {
    test('creates a contract add-on and returns 201', async () => {
      mockAuthUser();
      const addonRow = { id: 10, contract_id: 1, plan_addon_id: 3, quantity: 1, unit_price: 50, status: 'active' };
      db.query
        .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }])  // INSERT
        .mockResolvedValueOnce([[addonRow]]);                         // SELECT

      const res = await request(app)
        .post('/api/contracts/1/addons')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ plan_addon_id: 3, quantity: 1, unit_price: 50 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(10);
    });
  });
});

// =============================================================================
// 2. INVOICE ROUTES — /api/invoices
// =============================================================================
describe('Invoice Routes — /api/invoices', () => {

  const mockInvoice = {
    id: 1,
    organization_id: 1,
    client_id: 10,
    contract_id: 5,
    invoice_number: 'INV-000001',
    subtotal: 499.00,
    tax_amount: 79.84,
    total: 578.84,
    currency: 'MXN',
    tax_rate: 16,
    due_date: '2025-02-01',
    status: 'issued',
  };

  // --- GET / ---
  describe('GET /api/invoices', () => {
    test('returns paginated list of invoices', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockInvoice]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/invoices');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/invoices/:id', () => {
    test('returns an invoice by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockInvoice]]);

      const res = await request(app)
        .get('/api/invoices/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.invoice_number).toBe('INV-000001');
    });

    test('returns 404 when invoice not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/invoices/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/invoices', () => {
    test('creates an invoice and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockInvoice, id: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, subtotal: 499, total: 578.84, due_date: '2025-02-01' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/invoices/:id', () => {
    test('updates an invoice', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockInvoice]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockInvoice, status: 'paid' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/invoices/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'paid' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/invoices/:id', () => {
    test('deletes an invoice and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockInvoice]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/invoices/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /:id/items ---
  describe('GET /api/invoices/:id/items', () => {
    test('returns line items for an invoice', async () => {
      mockAuthUser();
      const item = { id: 1, invoice_id: 1, description: '50 Mbps Plan', quantity: 1, unit_price: 499, amount: 499 };
      db.query.mockResolvedValueOnce([[item]]);

      const res = await request(app)
        .get('/api/invoices/1/items')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].description).toBe('50 Mbps Plan');
    });
  });

  // --- POST /:id/items ---
  describe('POST /api/invoices/:id/items', () => {
    test('adds an invoice line item and returns 201', async () => {
      mockAuthUser();
      const newItem = { id: 5, invoice_id: 1, description: 'Static IP', quantity: 1, unit_price: 50, amount: 50 };
      // The route org-verifies + void-guards the invoice first (migration
      // 390 hardening), THEN Invoice.addItem calls db.query twice: INSERT
      // then SELECT.
      db.query
        .mockResolvedValueOnce([[{ id: 1, status: 'issued' }]])
        .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }])
        .mockResolvedValueOnce([[newItem]]);

      const res = await request(app)
        .post('/api/invoices/1/items')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'Static IP', quantity: 1, unit_price: 50, amount: 50 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(5);
    });
  });

  // --- GET /:id/payments ---
  describe('GET /api/invoices/:id/payments', () => {
    test('returns payment allocations for an invoice', async () => {
      mockAuthUser();
      const alloc = { id: 1, payment_id: 2, invoice_id: 1, amount: 578.84, payment_amount: 578.84, payment_method: 'transfer' };
      db.query.mockResolvedValueOnce([[alloc]]);

      const res = await request(app)
        .get('/api/invoices/1/payments')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});

// =============================================================================
// 3. PAYMENT ROUTES — /api/payments
// =============================================================================
describe('Payment Routes — /api/payments', () => {

  const mockPayment = {
    id: 1,
    organization_id: 1,
    client_id: 10,
    amount: 578.84,
    currency: 'MXN',
    payment_method: 'bank_transfer',
    reference_number: 'REF-001',
    status: 'completed',
  };

  // --- GET / ---
  describe('GET /api/payments', () => {
    test('returns paginated list of payments', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockPayment]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/payments');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/payments/:id', () => {
    test('returns a payment by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockPayment]]);

      const res = await request(app)
        .get('/api/payments/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(578.84);
    });

    test('returns 404 when payment not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/payments/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / (custom handler) ---
  describe('POST /api/payments', () => {
    test('creates a payment via custom handler and returns 201', async () => {
      mockAuthUser();
      // No `currency` in the request — POST /payments now defaults it from
      // Organization.getCurrency(req.orgId) before Payment.create().
      db.query
        .mockResolvedValueOnce([[{ currency: 'MXN' }]])                    // Organization.getCurrency
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])        // INSERT
        .mockResolvedValueOnce([[{ ...mockPayment, id: 2 }]])              // findById
        // billingService.recordPaymentCredit: INSERT into ledger
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 10, amount: 578.84, payment_method: 'bank_transfer' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/payments/:id', () => {
    test('updates a payment', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockPayment]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockPayment, status: 'refunded' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/payments/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'refunded' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('refunded');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/payments/:id', () => {
    test('deletes a payment and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockPayment]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/payments/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- POST /:id/allocate ---
  describe('POST /api/payments/:id/allocate', () => {
    const PAYMENT_ROW = { id: 1, client_id: 9, amount: 578.84, organization_id: 1 };

    test('allocates payment to invoice and returns 201', async () => {
      mockAuthUser();
      const allocation = { id: 1, payment_id: 1, invoice_id: 5, amount: 578.84 };
      const invoice = { id: 5, total: 578.84, contract_id: 3, organization_id: 1, status: 'issued' };

      // Payment org-verify happens FIRST, then invoice lookup (void guard),
      // then Payment.allocate runs (INSERT → SELECT), then SUM + status update.
      db.query
        .mockResolvedValueOnce([[PAYMENT_ROW]])                        // SELECT payment (org-verify)
        .mockResolvedValueOnce([[invoice]])                            // SELECT invoice (void guard)
        .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }])   // INSERT allocation
        .mockResolvedValueOnce([[allocation]])                         // SELECT allocation
        .mockResolvedValueOnce([[{ total_allocated: '578.84' }]])      // SUM allocations
        // update invoice status to 'paid'
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // check if contract was suspended
        .mockResolvedValueOnce([[]]);                                  // no suspended contract

      const res = await request(app)
        .post('/api/payments/1/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 5, amount: 578.84 });

      expect(res.status).toBe(201);
      expect(res.body.data.payment_id).toBe(1);
    });

    test('allocates payment partially (invoice not fully paid)', async () => {
      mockAuthUser();
      const allocation = { id: 2, payment_id: 1, invoice_id: 5, amount: 200 };
      const invoice = { id: 5, total: 578.84, contract_id: 3, organization_id: 1, status: 'issued' };

      db.query
        .mockResolvedValueOnce([[PAYMENT_ROW]])                        // SELECT payment (org-verify)
        .mockResolvedValueOnce([[invoice]])                            // SELECT invoice (void guard)
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
        .mockResolvedValueOnce([[allocation]])
        .mockResolvedValueOnce([[{ total_allocated: '200' }]]);  // partial — not enough

      const res = await request(app)
        .post('/api/payments/1/allocate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invoice_id: 5, amount: 200 });

      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe(200);
    });
  });

  // --- GET /:id/allocations ---
  describe('GET /api/payments/:id/allocations', () => {
    test('returns allocations for a payment', async () => {
      mockAuthUser();
      const alloc = { id: 1, payment_id: 1, invoice_id: 5, amount: 578.84 };
      db.query.mockResolvedValueOnce([[alloc]]);

      const res = await request(app)
        .get('/api/payments/1/allocations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});

// =============================================================================
// 4. USER ROUTES — /api/users
// =============================================================================
describe('User Routes — /api/users', () => {

  const mockUser = {
    id: 2,
    organization_id: 1,
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    role: 'support',
    phone: '+525551234567',
    status: 'active',
  };

  // Since User is jest.mock'd, we set static properties for crudController
  beforeEach(() => {
    User.hasOrgScope = true;
    User.tableName = 'users';
    User.fillable = [
      'organization_id', 'first_name', 'last_name', 'email',
      'password_hash', 'role', 'phone', 'status',
    ];
    User.sortable = ['id', 'created_at', 'updated_at', 'first_name', 'last_name', 'email', 'role', 'status'];
  });

  // --- GET / ---
  describe('GET /api/users', () => {
    test('returns paginated list of users', async () => {
      mockAuthUser();
      User.findAll.mockResolvedValue([mockUser]);
      User.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/users/:id', () => {
    test('returns a user by id', async () => {
      mockAuthUser();
      User.findByIdOrFail.mockResolvedValue(mockUser);

      const res = await request(app)
        .get('/api/users/2')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('jane@example.com');
    });

    test('returns 404 when user not found', async () => {
      mockAuthUser();
      const { NotFoundError } = require('../src/utils/errors');
      User.findByIdOrFail.mockRejectedValue(new NotFoundError('users'));

      const res = await request(app)
        .get('/api/users/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/users', () => {
    test('creates a user and returns 201', async () => {
      mockAuthUser();
      User.create.mockResolvedValue({ ...mockUser, id: 3 });
      // auditLog.log calls db.query
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          password: 'securepass1',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(3);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/users/:id', () => {
    test('updates a user', async () => {
      mockAuthUser();
      User.findByIdOrFail.mockResolvedValue(mockUser);
      User.update.mockResolvedValue({ ...mockUser, first_name: 'Janet' });
      db.query.mockResolvedValue([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .put('/api/users/2')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ first_name: 'Janet' });

      expect(res.status).toBe(200);
      expect(res.body.data.first_name).toBe('Janet');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/users/:id', () => {
    test('deletes a user and returns 204', async () => {
      mockAuthUser();
      User.findByIdOrFail.mockResolvedValue(mockUser);
      User.delete.mockResolvedValue(true);
      db.query.mockResolvedValue([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .delete('/api/users/2')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /:id/permissions ---
  describe('GET /api/users/:id/permissions', () => {
    test('returns permissions for a user', async () => {
      mockAuthUser();
      User.getPermissions.mockResolvedValue(['users.view', 'clients.view', 'invoices.view']);

      const res = await request(app)
        .get('/api/users/2/permissions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toContain('users.view');
      expect(res.body.data).toHaveLength(3);
    });
  });
});

// =============================================================================
// 5. DEVICE ROUTES — /api/devices
// =============================================================================
describe('Device Routes — /api/devices', () => {

  const mockDevice = {
    id: 1,
    organization_id: 1,
    site_id: 2,
    contract_id: 3,
    name: 'CPE-001',
    type: 'router',
    manufacturer: 'MikroTik',
    model: 'hAP ac2',
    serial_number: 'SN12345',
    mac_address: 'AA:BB:CC:DD:EE:FF',
    ip_address: '192.168.1.1',
    snmp_enabled: true,
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/devices', () => {
    test('returns paginated list of devices', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockDevice]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/devices')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/devices');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/devices/:id', () => {
    test('returns a device by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockDevice]]);

      const res = await request(app)
        .get('/api/devices/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('CPE-001');
    });

    test('returns 404 when device not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/devices/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/devices', () => {
    test('creates a device and returns 201', async () => {
      mockAuthUser();
      db.query
        // quotaCheck: SELECT * FROM organization_quotas → no row → unlimited
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockDevice, id: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/devices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'CPE-001', type: 'router' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/devices/:id', () => {
    test('updates a device', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockDevice]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockDevice, status: 'maintenance' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/devices/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'maintenance' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('maintenance');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/devices/:id', () => {
    test('deletes a device and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockDevice]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/devices/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /:id/snmp-metrics ---
  describe('GET /api/devices/:id/snmp-metrics', () => {
    test('returns SNMP metrics for a device', async () => {
      mockAuthUser();
      const metric = {
        id: 1, device_id: 1, oid: '1.3.6.1.2.1.1.1.0',
        value: 'RouterOS', polled_at: '2025-06-01T00:00:00Z',
      };
      // Ownership check (Device.findByIdOrFail) runs first, then the metrics query.
      db.query
        .mockResolvedValueOnce([[mockDevice]])
        .mockResolvedValueOnce([[metric]]);

      const res = await request(app)
        .get('/api/devices/1/snmp-metrics')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].oid).toBe('1.3.6.1.2.1.1.1.0');
    });

    test('returns empty array when no metrics', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockDevice]])
        .mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/devices/1/snmp-metrics')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    test('returns 404 when the device belongs to a different org (cross-org leak regression)', async () => {
      mockAuthUser();
      // Ownership check finds no matching row for this org — mirrors every
      // other org-scoped 404 in this suite.
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/devices/1/snmp-metrics')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- client_id FK org-scoping (fix/diagnostic-engine-blindness-client-id) ---
  // devices.client_id was previously absent from both the validation schemas
  // and Device.fillable, so POST/PUT/PATCH silently dropped it (200 OK, field
  // unchanged) — diagnosticEngineService._resolveOnuDeviceId could therefore
  // never find a client's ONU. Now that it is settable, a cross-tenant FK
  // check (assertDeviceClientFk) is required so an org-A caller cannot link
  // a device to an org-B client id.
  describe('client_id FK org-scoping', () => {
    test('POST persists client_id when it belongs to the caller organization', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]]) // quotaCheck: no row -> unlimited
        .mockResolvedValueOnce([[{ id: 42, organization_id: 1 }]]) // Client.findById -> found in this org
        .mockResolvedValueOnce([{ insertId: 3, affectedRows: 1 }]) // INSERT devices
        .mockResolvedValueOnce([[{ ...mockDevice, id: 3, type: 'onu', client_id: 42 }]]) // findByIdIncludingDeleted
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // audit_log INSERT

      const res = await request(app)
        .post('/api/devices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'ONU-100', type: 'onu', client_id: 42 });

      expect(res.status).toBe(201);
      expect(res.body.data.client_id).toBe(42);
    });

    test('POST rejects a client_id belonging to another organization with 422', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]]) // quotaCheck: no row -> unlimited
        .mockResolvedValueOnce([[]]); // Client.findById -> not found in this org

      const res = await request(app)
        .post('/api/devices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'ONU-101', type: 'onu', client_id: 999 });

      expect(res.status).toBe(422);
    });

    test('PUT rejects a client_id belonging to another organization with 422', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockDevice]]) // findByIdOrFail (old)
        .mockResolvedValueOnce([[]]); // Client.findById -> not found in this org

      const res = await request(app)
        .put('/api/devices/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 999 });

      expect(res.status).toBe(422);
    });

    test('PATCH persists client_id when it belongs to the caller organization', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockDevice]]) // findByIdOrFail (old)
        .mockResolvedValueOnce([[{ id: 42, organization_id: 1 }]]) // Client.findById (beforeUpdate hook)
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
        .mockResolvedValueOnce([[{ ...mockDevice, client_id: 42 }]]) // findById (updated)
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // audit_log INSERT

      const res = await request(app)
        .patch('/api/devices/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 42 });

      expect(res.status).toBe(200);
      expect(res.body.data.client_id).toBe(42);
    });

    test('PATCH rejects a client_id belonging to another organization with 422', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockDevice]]) // findByIdOrFail (old)
        .mockResolvedValueOnce([[]]); // Client.findById -> not found in this org

      const res = await request(app)
        .patch('/api/devices/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: 999 });

      expect(res.status).toBe(422);
    });

    test('PATCH with client_id: null clears the link without an org check', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ ...mockDevice, client_id: 42 }]]) // findByIdOrFail (old, had a client)
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE (no Client.findById in between)
        .mockResolvedValueOnce([[{ ...mockDevice, client_id: null }]]) // findById (updated)
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // audit_log INSERT

      const res = await request(app)
        .patch('/api/devices/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_id: null });

      expect(res.status).toBe(200);
      expect(res.body.data.client_id).toBeNull();
    });
  });
});

// =============================================================================
// 6. TICKET ROUTES — /api/tickets
// =============================================================================
describe('Ticket Routes — /api/tickets', () => {

  const mockTicket = {
    id: 1,
    organization_id: 1,
    client_id: 10,
    contract_id: 5,
    assigned_to: 2,
    subject: 'Internet outage',
    description: 'Customer reports no connectivity.',
    priority: 'high',
    category: 'network',
    status: 'open',
  };

  // --- GET / ---
  describe('GET /api/tickets', () => {
    test('returns paginated list of tickets', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockTicket]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/tickets');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/tickets/:id', () => {
    test('returns a ticket by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockTicket]]);

      const res = await request(app)
        .get('/api/tickets/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.subject).toBe('Internet outage');
    });

    test('returns 404 when ticket not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/tickets/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/tickets', () => {
    test('creates a ticket and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockTicket, id: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/tickets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ subject: 'Internet outage', priority: 'high', category: 'technical', client_id: 10 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/tickets/:id', () => {
    test('updates a ticket', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockTicket]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockTicket, status: 'resolved' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/tickets/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'resolved' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('resolved');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/tickets/:id', () => {
    test('deletes a ticket and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockTicket]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/tickets/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /:id/comments ---
  describe('GET /api/tickets/:id/comments', () => {
    test('returns comments for a ticket', async () => {
      mockAuthUser();
      const comment = {
        id: 1, ticket_id: 1, user_id: 1, body: 'Working on it.',
        is_internal: false, first_name: 'Test', last_name: 'User',
      };
      db.query.mockResolvedValueOnce([[comment]]);

      const res = await request(app)
        .get('/api/tickets/1/comments')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].body).toBe('Working on it.');
    });
  });

  // --- POST /:id/comments ---
  describe('POST /api/tickets/:id/comments', () => {
    test('adds a comment to a ticket and returns 201', async () => {
      mockAuthUser();
      const newComment = { id: 5, ticket_id: 1, user_id: 1, body: 'Issue resolved.', is_internal: false };
      db.query
        .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }])  // INSERT ticket_comments
        .mockResolvedValueOnce([[newComment]])                       // SELECT ticket_comment
        .mockResolvedValueOnce([[{ id: 1, organization_id: 1, contract_id: null }]]); // SELECT ticket for aiTriage

      const res = await request(app)
        .post('/api/tickets/1/comments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ body: 'Issue resolved.' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(5);
      expect(res.body.data.body).toBe('Issue resolved.');
    });

    test('adds an internal comment', async () => {
      mockAuthUser();
      const newComment = { id: 6, ticket_id: 1, user_id: 1, body: 'Internal note.', is_internal: true };
      db.query
        .mockResolvedValueOnce([{ insertId: 6, affectedRows: 1 }])
        .mockResolvedValueOnce([[newComment]]);

      const res = await request(app)
        .post('/api/tickets/1/comments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ body: 'Internal note.', is_internal: true });

      expect(res.status).toBe(201);
      expect(res.body.data.is_internal).toBe(true);
    });
  });

  // --- PUT /:id/comments/:commentId ---
  describe('PUT /api/tickets/:id/comments/:commentId', () => {
    test('updates a comment and returns the updated record', async () => {
      mockAuthUser();
      const updated = { id: 5, ticket_id: 1, user_id: 1, body: 'Edited body.', is_internal: false };
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[updated]]);

      const res = await request(app)
        .put('/api/tickets/1/comments/5')
        .set('Authorization', 'Bearer ' + authToken)
        .send({ body: 'Edited body.' });

      expect(res.status).toBe(200);
      expect(res.body.data.body).toBe('Edited body.');
    });

    test('returns 404 when the comment does not exist', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const res = await request(app)
        .put('/api/tickets/1/comments/999')
        .set('Authorization', 'Bearer ' + authToken)
        .send({ body: 'Edited body.' });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /:id/comments/:commentId ---
  describe('DELETE /api/tickets/:id/comments/:commentId', () => {
    test('soft-deletes a comment and returns 204', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/tickets/1/comments/5')
        .set('Authorization', 'Bearer ' + authToken);

      expect(res.status).toBe(204);
    });

    test('returns 404 when the comment does not exist', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const res = await request(app)
        .delete('/api/tickets/1/comments/999')
        .set('Authorization', 'Bearer ' + authToken);

      expect(res.status).toBe(404);
    });
  });
});

// =============================================================================
// 7. PLAN ROUTES — /api/plans
// =============================================================================
describe('Plan Routes — /api/plans', () => {

  const mockPlan = {
    id: 1,
    organization_id: 1,
    name: '50 Mbps Fiber',
    description: 'Basic fiber plan',
    download_speed_mbps: 50,
    upload_speed_mbps: 25,
    price: 499.00,
    currency: 'MXN',
    billing_cycle: 'monthly',
    data_cap_gb: null,
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/plans', () => {
    test('returns paginated list of plans', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockPlan]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/plans')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/plans');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/plans/:id', () => {
    test('returns a plan by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockPlan]]);

      const res = await request(app)
        .get('/api/plans/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('50 Mbps Fiber');
    });

    test('returns 404 when plan not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/plans/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/plans', () => {
    test('creates a plan and returns 201', async () => {
      mockAuthUser();
      db.query
        // Organization.getCurrency — called first when currency is absent in body
        .mockResolvedValueOnce([[{ currency: 'MXN' }]])
        // BaseModel.create INSERT
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
        // BaseModel.create SELECT after insert
        .mockResolvedValueOnce([[{ ...mockPlan, id: 2 }]])
        // auditLog.log INSERT
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/plans')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '50 Mbps Fiber', download_speed_mbps: 50, upload_speed_mbps: 25, price: 499 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/plans/:id', () => {
    test('updates a plan', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockPlan]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockPlan, price: 599 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/plans/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ price: 599 });

      expect(res.status).toBe(200);
      expect(res.body.data.price).toBe(599);
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/plans/:id', () => {
    test('deletes a plan and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockPlan]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/plans/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /addons/catalog ---
  describe('GET /api/plans/addons/catalog', () => {
    test('returns add-on catalog for the organization', async () => {
      mockAuthUser();
      const addon = { id: 1, organization_id: 1, name: 'Static IP', addon_type: 'static_ip', price: 50, status: 'active' };
      db.query.mockResolvedValueOnce([[addon]]);

      const res = await request(app)
        .get('/api/plans/addons/catalog')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Static IP');
    });
  });

  // --- POST /addons ---
  describe('POST /api/plans/addons', () => {
    test('creates a plan add-on and returns 201', async () => {
      mockAuthUser();
      const newAddon = { id: 3, organization_id: 1, name: 'Extra IP Block', addon_type: 'extra_ip_block', price: 100, status: 'active' };
      db.query
        .mockResolvedValueOnce([{ insertId: 3, affectedRows: 1 }])
        .mockResolvedValueOnce([[newAddon]]);

      const res = await request(app)
        .post('/api/plans/addons')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Extra IP Block', addon_type: 'extra_ip_block', price: 100 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(3);
      expect(res.body.data.addon_type).toBe('extra_ip_block');
    });
  });
});

// =============================================================================
// 8. ORGANIZATION ROUTES — /api/organizations
// =============================================================================
describe('Organization Routes — /api/organizations', () => {

  const mockOrg = {
    id: 1,
    name: 'ISP Mexico',
    legal_name: 'ISP Mexico S.A. de C.V.',
    email: 'admin@ispmx.com',
    phone: '+525551234567',
    address: 'Calle 1',
    city: 'CDMX',
    state: 'CDMX',
    zip_code: '06600',
    country: 'MX',
    locale: 'es-MX',
    tax_id: 'ISP123456ABC',
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/organizations', () => {
    test('returns paginated list of organizations', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockOrg]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/organizations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/organizations');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/organizations/:id', () => {
    test('returns an organization by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockOrg]]);

      const res = await request(app)
        .get('/api/organizations/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('ISP Mexico');
    });

    test('returns 404 when organization not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/organizations/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/organizations', () => {
    test('creates an organization and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockOrg, id: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/organizations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'ISP Mexico', email: 'admin@ispmx.com' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/organizations/:id', () => {
    test('updates an organization', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockOrg]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...mockOrg, name: 'ISP Updated' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/organizations/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'ISP Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('ISP Updated');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/organizations/:id', () => {
    test('deletes an organization and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockOrg]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/organizations/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /:id/settings ---
  describe('GET /api/organizations/:id/settings', () => {
    test('returns settings for an organization', async () => {
      mockAuthUser();
      // Organization.getSettings calls db.query
      db.query.mockResolvedValueOnce([[
        { key: 'billing.currency', value: 'MXN', description: 'Default currency' },
        { key: 'billing.tax_rate', value: '16', description: 'Default tax rate' },
      ]]);

      const res = await request(app)
        .get('/api/organizations/1/settings')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data['billing.currency']).toBe('MXN');
      expect(res.body.data['billing.tax_rate']).toBe('16');
    });
  });

  // --- PUT /:id/settings/:key ---
  describe('PUT /api/organizations/:id/settings/:key', () => {
    test('updates a setting value for an organization', async () => {
      mockAuthUser();
      // setSetting for the 'value' key, then getSettings
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // setSetting
        .mockResolvedValueOnce([[                       // getSettings after update
          { key: 'billing.currency', value: 'USD' },
        ]]);

      const res = await request(app)
        .put('/api/organizations/1/settings/billing.currency')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ value: 'USD' });

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data['billing.currency']).toBe('USD');
    });

    test('returns 422 when value is missing', async () => {
      mockAuthUser();

      const res = await request(app)
        .put('/api/organizations/1/settings/billing.currency')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(422);
    });
  });
});

// =============================================================================
// 9. ROLE ROUTES — /api/roles
// =============================================================================
describe('Role Routes — /api/roles', () => {

  const mockRole = {
    id: 1,
    name: 'admin',
    description: 'Full access to all resources',
  };

  const mockPermissions = [
    { id: 1, slug: 'clients.view', description: 'View clients' },
    { id: 2, slug: 'clients.create', description: 'Create clients' },
  ];

  // --- GET / ---
  describe('GET /api/roles', () => {
    test('returns list of roles', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockRole, { id: 2, name: 'support', description: 'Support staff' }]])
        .mockResolvedValueOnce([[{ total: 2 }]]);

      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].name).toBe('admin');
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(2);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/roles');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/roles/:id', () => {
    test('returns a role with its permissions', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockRole]])        // SELECT role
        .mockResolvedValueOnce([mockPermissions]);   // SELECT permissions

      const res = await request(app)
        .get('/api/roles/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('admin');
      expect(res.body.data.permissions).toHaveLength(2);
      expect(res.body.data.permissions[0].slug).toBe('clients.view');
    });

    test('returns 404 when role not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/roles/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/roles', () => {
    test('creates a role and returns 201', async () => {
      mockAuthUser();
      const newRole = { id: 3, name: 'billing', description: 'Billing team', kind: 'billing' };
      db.query
        .mockResolvedValueOnce([{ insertId: 3, affectedRows: 1 }])  // INSERT
        .mockResolvedValueOnce([[newRole]]);                          // SELECT

      const res = await request(app)
        .post('/api/roles')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'billing', description: 'Billing team', kind: 'billing' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(3);
      expect(res.body.data.name).toBe('billing');
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/roles/:id', () => {
    test('updates a role', async () => {
      mockAuthUser();
      const updatedRole = { id: 1, name: 'superadmin', description: 'Updated description' };
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'old-custom', kind: 'billing', is_system: 0 }]])  // pre-fetch (378 system-role guard)
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE
        .mockResolvedValueOnce([[updatedRole]]);          // SELECT

      const res = await request(app)
        .put('/api/roles/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'superadmin', description: 'Updated description' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('superadmin');
    });

    test('returns 404 when role not found for update', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]]);  // pre-fetch — not found (378 guard runs first)

      const res = await request(app)
        .put('/api/roles/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'ghost', description: 'No role' });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/roles/:id', () => {
    test('deletes a role and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ ...mockRole, name: 'custom', is_system: 0 }]])  // SELECT — exists, non-system (378 guard)
        .mockResolvedValueOnce([[{ cnt: 0 }]])             // COUNT assigned users (378 guard)
        .mockResolvedValueOnce([{ affectedRows: 1 }]);     // DELETE

      const res = await request(app)
        .delete('/api/roles/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });

    test('returns 404 when role not found for delete', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // SELECT — not found

      const res = await request(app)
        .delete('/api/roles/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST /:id/permissions ---
  describe('POST /api/roles/:id/permissions', () => {
    test('assigns a permission to a role and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT role_permissions
        .mockResolvedValueOnce([mockPermissions]);       // SELECT updated permissions

      const res = await request(app)
        .post('/api/roles/1/permissions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ permission_id: 2 });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(2);
    });
  });

  // --- DELETE /:id/permissions/:permissionId ---
  describe('DELETE /api/roles/:id/permissions/:permissionId', () => {
    test('removes a permission from a role and returns 204', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);  // DELETE role_permission

      const res = await request(app)
        .delete('/api/roles/1/permissions/2')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });
});

// =============================================================================
// CROSS-CUTTING CONCERNS
// =============================================================================
describe('Cross-cutting — auth and 404 edge cases', () => {

  // Additional 401 tests for remaining route groups
  describe('POST endpoints require auth', () => {
    test('POST /api/contracts returns 401 without auth', async () => {
      const res = await request(app).post('/api/contracts').send({ client_id: 1, plan_id: 1 });
      expect(res.status).toBe(401);
    });

    test('PUT /api/invoices/1 returns 401 without auth', async () => {
      const res = await request(app).put('/api/invoices/1').send({ status: 'paid' });
      expect(res.status).toBe(401);
    });

    test('DELETE /api/payments/1 returns 401 without auth', async () => {
      const res = await request(app).delete('/api/payments/1');
      expect(res.status).toBe(401);
    });

    test('POST /api/tickets returns 401 without auth', async () => {
      const res = await request(app).post('/api/tickets').send({ subject: 'Test' });
      expect(res.status).toBe(401);
    });

    test('POST /api/plans returns 401 without auth', async () => {
      const res = await request(app).post('/api/plans').send({ name: 'Plan' });
      expect(res.status).toBe(401);
    });

    test('POST /api/organizations returns 401 without auth', async () => {
      const res = await request(app).post('/api/organizations').send({ name: 'Org' });
      expect(res.status).toBe(401);
    });

    test('POST /api/roles returns 401 without auth', async () => {
      const res = await request(app).post('/api/roles').send({ name: 'role' });
      expect(res.status).toBe(401);
    });

    test('POST /api/devices returns 401 without auth', async () => {
      const res = await request(app).post('/api/devices').send({ name: 'Device', type: 'router' });
      expect(res.status).toBe(401);
    });
  });

  // Additional 404 tests for GET /:id on remaining routes
  describe('GET /:id returns 404 for non-existent records', () => {
    test('GET /api/contracts/0 returns 404', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/contracts/0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    test('GET /api/devices/0 returns 404', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/devices/0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    test('GET /api/plans/0 returns 404', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/plans/0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    test('GET /api/organizations/0 returns 404', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/organizations/0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // Pagination parameter tests
  describe('Pagination query params', () => {
    test('GET /api/contracts with page=2&limit=10 passes pagination', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app)
        .get('/api/contracts?page=2&limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.limit).toBe(10);
    });

    test('GET /api/invoices with order_by=created_at&order=DESC', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app)
        .get('/api/invoices?order_by=created_at&order=DESC')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // Empty list tests
  describe('Empty list responses', () => {
    test('GET /api/tickets returns empty data and zero total', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
      expect(res.body.meta.totalPages).toBe(0);
    });

    test('GET /api/payments returns empty data and zero total', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });
  });
});
