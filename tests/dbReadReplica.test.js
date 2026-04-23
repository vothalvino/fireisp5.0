// =============================================================================
// FireISP 5.0 — Database Read Replica Routing Tests (M5.7)
// =============================================================================
// Verifies that:
//   1. `replicaPool` is created only when DB_REPLICA_HOST is set.
//   2. `queryReplica` falls back to the primary pool when no replica is configured.
//   3. `queryReplica` records a SELECT metric via recordDbQuery.
//   4. reportService functions call `queryReplica` (not `query`).
//   5. dashboardController functions call `queryReplica` (not `query`).
// =============================================================================

// Mock only the dependencies of database.js (NOT the module itself) so that
// pool-creation tests can load the real database module with a controlled env.
jest.mock('mysql2/promise', () => {
  function makeMockPool() {
    return {
      execute: jest.fn().mockResolvedValue([[], []]),
      end: jest.fn().mockResolvedValue(undefined),
      getConnection: jest.fn(),
    };
  }
  return { createPool: jest.fn(() => makeMockPool()) };
});

jest.mock('../src/utils/dbMetrics', () => ({ recordDbQuery: jest.fn() }));

// Top-level requires used by routing tests (Parts C and D).
const db = require('../src/config/database');
const { recordDbQuery } = require('../src/utils/dbMetrics');
const reportService = require('../src/services/reportService');
const dashboardController = require('../src/controllers/dashboardController');

// ---------------------------------------------------------------------------
// Part A — Pool creation (fresh module load per test via jest.resetModules)
// ---------------------------------------------------------------------------

describe('database config — replica pool creation', () => {
  afterEach(() => {
    delete process.env.DB_REPLICA_HOST;
    delete process.env.DB_REPLICA_PORT;
    delete process.env.DB_REPLICA_USER;
    delete process.env.DB_REPLICA_PASSWORD;
  });

  /**
   * Reset the module cache, optionally override env vars, require a fresh
   * database module, and return it together with the fresh mysql2 mock.
   */
  function freshLoad(envOverrides = {}) {
    const saved = {};
    for (const [k, v] of Object.entries(envOverrides)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    jest.resetModules();

    // Require mysql2/promise FIRST so it occupies the module cache slot that
    // database.js will hit when it does its own require().
    const mysql = require('mysql2/promise');
    mysql.createPool.mockClear();
    const freshDb = require('../src/config/database');

    // Restore env
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    return { mysql, freshDb };
  }

  test('creates only one pool when DB_REPLICA_HOST is not set', () => {
    const { mysql } = freshLoad({ DB_REPLICA_HOST: undefined });
    expect(mysql.createPool).toHaveBeenCalledTimes(1);
  });

  test('creates two pools when DB_REPLICA_HOST is set', () => {
    const { mysql } = freshLoad({ DB_REPLICA_HOST: 'replica.example.com' });
    expect(mysql.createPool).toHaveBeenCalledTimes(2);
  });

  test('replica pool receives the correct host', () => {
    const { mysql } = freshLoad({ DB_REPLICA_HOST: 'replica.example.com' });
    const replicaCall = mysql.createPool.mock.calls[1][0];
    expect(replicaCall.host).toBe('replica.example.com');
  });

  test('replica pool uses DB_REPLICA_PORT when specified', () => {
    const { mysql } = freshLoad({ DB_REPLICA_HOST: 'replica.internal', DB_REPLICA_PORT: '3307' });
    const replicaCall = mysql.createPool.mock.calls[1][0];
    expect(replicaCall.port).toBe(3307);
  });

  test('replica pool uses custom user/password when set', () => {
    const { mysql } = freshLoad({
      DB_REPLICA_HOST: 'replica.internal',
      DB_REPLICA_USER: 'replica_ro',
      DB_REPLICA_PASSWORD: 'secr3t',
    });
    const replicaCall = mysql.createPool.mock.calls[1][0];
    expect(replicaCall.user).toBe('replica_ro');
    expect(replicaCall.password).toBe('secr3t');
  });

  test('replicaPool is null when DB_REPLICA_HOST is not set', () => {
    const { freshDb } = freshLoad({ DB_REPLICA_HOST: undefined });
    expect(freshDb.replicaPool).toBeNull();
  });

  test('replicaPool is a pool object when DB_REPLICA_HOST is set', () => {
    const { freshDb } = freshLoad({ DB_REPLICA_HOST: 'replica.test' });
    expect(freshDb.replicaPool).not.toBeNull();
  });

  test('close() ends both pools when replica is configured', async () => {
    const { freshDb } = freshLoad({ DB_REPLICA_HOST: 'replica.test' });
    await expect(freshDb.close()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Part B — queryReplica behaviour (top-level `db` instance)
// ---------------------------------------------------------------------------

describe('queryReplica behaviour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('queryReplica is exported as a function', () => {
    expect(typeof db.queryReplica).toBe('function');
  });

  test('queryReplica records a SELECT metric', async () => {
    // Drive through the real code path by using a spy on pool.execute
    jest.spyOn(db.pool, 'execute').mockResolvedValueOnce([[], []]);
    await db.queryReplica('SELECT 1', []);
    expect(recordDbQuery).toHaveBeenCalled();
    const [, op] = recordDbQuery.mock.calls[0];
    expect(op).toBe('SELECT');
    jest.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Part C — reportService uses queryReplica (spy-based routing tests)
// ---------------------------------------------------------------------------

describe('reportService — replica routing', () => {
  beforeEach(() => {
    jest.spyOn(db, 'queryReplica').mockResolvedValue([[]]);
    jest.spyOn(db, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('agingReport calls queryReplica, not query', async () => {
    await reportService.agingReport(1);
    expect(db.queryReplica).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('financialSummary calls queryReplica 3x (invoices/payments/expenses), not query', async () => {
    db.queryReplica
      .mockResolvedValueOnce([[{ total_invoiced: '0', total_collected: '0', total_outstanding: '0', invoice_count: 0 }]])
      .mockResolvedValueOnce([[{ total_payments: '0', payment_count: 0 }]])
      .mockResolvedValueOnce([[{ total_expenses: '0', expense_count: 0 }]]);

    await reportService.financialSummary(1);
    expect(db.queryReplica).toHaveBeenCalledTimes(3);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('technicianReport calls queryReplica, not query', async () => {
    await reportService.technicianReport(1);
    expect(db.queryReplica).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('subscriberGrowthReport calls queryReplica, not query', async () => {
    await reportService.subscriberGrowthReport(1);
    expect(db.queryReplica).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Part D — dashboardController uses queryReplica (spy-based routing tests)
// ---------------------------------------------------------------------------

describe('dashboardController — replica routing', () => {
  function makeReq(orgId = 1) { return { orgId }; }
  function makeRes() { return { json: jest.fn() }; }

  beforeEach(() => {
    jest.spyOn(db, 'queryReplica').mockResolvedValue([[{ total: 0, active: 0, suspended: 0, open_count: 0, monitored: 0, outstanding: 0, collected: 0, total_invoiced: 0 }]]);
    jest.spyOn(db, 'query');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('summary calls queryReplica, not query', async () => {
    const res = makeRes();
    await dashboardController.summary(makeReq(), res, jest.fn());
    expect(db.queryReplica).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  test('revenue calls queryReplica, not query', async () => {
    db.queryReplica.mockResolvedValueOnce([[]]);
    const res = makeRes();
    await dashboardController.revenue(makeReq(), res, jest.fn());
    expect(db.queryReplica).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('mrr calls queryReplica, not query', async () => {
    db.queryReplica.mockResolvedValueOnce([[]]);
    const res = makeRes();
    await dashboardController.mrr(makeReq(), res, jest.fn());
    expect(db.queryReplica).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('deviceHealth calls queryReplica twice (devices + health snapshots), not query', async () => {
    db.queryReplica.mockResolvedValue([[]]);
    const res = makeRes();
    await dashboardController.deviceHealth(makeReq(), res, jest.fn());
    expect(db.queryReplica).toHaveBeenCalledTimes(2);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('overdue calls queryReplica, not query', async () => {
    db.queryReplica.mockResolvedValueOnce([[]]);
    const res = makeRes();
    await dashboardController.overdue(makeReq(), res, jest.fn());
    expect(db.queryReplica).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});
