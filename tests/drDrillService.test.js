// =============================================================================
// FireISP 5.0 — DR Drill Service Tests
// =============================================================================

jest.mock('../src/config/database');
jest.mock('../src/scripts/backup');

const db = require('../src/config/database');
const { backup } = require('../src/scripts/backup');
const drDrillService = require('../src/services/drDrillService');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set up db.query to return the standard "healthy" responses. */
function setupHealthyDb() {
  db.query.mockImplementation(async (sql) => {
    const q = sql.toLowerCase();

    // Row-count queries — COUNT(*) AS cnt
    if (q.includes('count(*) as cnt')) return [[{ cnt: 5 }]];

    // FK orphan queries — COUNT(*) AS n, result must be 0
    if (q.includes('count(*) as n')) return [[{ n: 0 }]];

    // INSERT into dr_drill_logs
    if (q.includes('insert into dr_drill_logs')) return [{ insertId: 1 }];

    // SELECT * FROM dr_drill_logs
    if (q.includes('select * from dr_drill_logs')) return [[]];

    return [[]];
  });
}

/** Set up backup mock to return a healthy backup filepath. */
function setupHealthyBackup(tmpPath) {
  fs.writeFileSync(tmpPath, Buffer.alloc(1_100_000, 'x'));
  backup.mockResolvedValue({ filepath: tmpPath, cloudUrl: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('drDrillService.runDrill', () => {
  const tmpFile = path.join(require('os').tmpdir(), 'dr_drill_test.sql.gz');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('returns status=pass when backup is large enough and all checks pass', async () => {
    setupHealthyBackup(tmpFile);
    setupHealthyDb();

    const result = await drDrillService.runDrill();

    expect(result.status).toBe('pass');
    expect(result.checks.backup_size_ok).toBe(true);
    expect(result.checks.fk_orphans_ok).toBe(true);
    expect(result.checks.financial_ok).toBe(true);
    expect(result.checks.schema_migrations_present).toBe(true);
    expect(typeof result.duration_ms).toBe('number');
  });

  it('throws and writes error log when backup file is too small', async () => {
    // Write file under 1MB
    fs.writeFileSync(tmpFile, Buffer.alloc(512, 'x'));
    backup.mockResolvedValue({ filepath: tmpFile, cloudUrl: null });
    setupHealthyDb();

    await expect(drDrillService.runDrill()).rejects.toThrow(/Backup too small/);

    const insertCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.toLowerCase().includes('insert into dr_drill_logs'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][0]).toBe('error');
  });

  it('returns status=fail when FK orphans are detected', async () => {
    setupHealthyBackup(tmpFile);

    db.query.mockImplementation(async (sql) => {
      const q = sql.toLowerCase();

      if (q.includes('count(*) as cnt')) return [[{ cnt: 5 }]];

      // Simulate orphaned contracts (FK orphan queries contain "contracts" and "clients")
      if (q.includes('count(*) as n') && q.includes('contracts') && q.includes('clients')) {
        return [[{ n: 3 }]];
      }
      if (q.includes('count(*) as n')) return [[{ n: 0 }]];

      if (q.includes('insert into dr_drill_logs')) return [{ insertId: 1 }];
      return [[]];
    });

    const result = await drDrillService.runDrill();

    expect(result.status).toBe('fail');
    expect(result.checks.fk_orphans_ok).toBe(false);
    expect(result.checks.fk_orphans.orphaned_contracts).toBe(3);
  });

  it('returns status=fail when financial inconsistencies are detected', async () => {
    setupHealthyBackup(tmpFile);

    db.query.mockImplementation(async (sql) => {
      const q = sql.toLowerCase();

      if (q.includes('count(*) as cnt')) return [[{ cnt: 5 }]];
      // FK orphan queries all zero (these contain COUNT(*) AS n but not invoice_items/payment_allocations)
      if (q.includes('count(*) as n') && !q.includes('invoice_items') && !q.includes('payment_allocations')) {
        return [[{ n: 0 }]];
      }
      // Financial check — inconsistent invoices
      if (q.includes('invoice_items')) return [[{ n: 2 }]];
      if (q.includes('payment_allocations')) return [[{ n: 0 }]];
      if (q.includes('count(*) as n')) return [[{ n: 0 }]];

      if (q.includes('insert into dr_drill_logs')) return [{ insertId: 1 }];
      return [[]];
    });

    const result = await drDrillService.runDrill();

    expect(result.status).toBe('fail');
    expect(result.checks.financial_ok).toBe(false);
    expect(result.checks.financial.inconsistent_invoices).toBe(2);
  });

  it('throws and writes error log when backup() rejects', async () => {
    backup.mockRejectedValue(new Error('mysqldump not found'));
    setupHealthyDb();

    await expect(drDrillService.runDrill()).rejects.toThrow('mysqldump not found');

    const insertCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.toLowerCase().includes('insert into dr_drill_logs'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][0]).toBe('error');
  });
});

describe('drDrillService.getDrillStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns overdue=true and null fields when no logs exist', async () => {
    db.query.mockResolvedValue([[]]);
    const status = await drDrillService.getDrillStatus();
    expect(status.overdue).toBe(true);
    expect(status.last_run_at).toBeNull();
    expect(status.status).toBeNull();
  });

  it('returns overdue=false for a recent passing drill', async () => {
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    db.query.mockResolvedValue([[
      { run_at: recentDate, status: 'pass', error_message: null },
    ]]);
    const status = await drDrillService.getDrillStatus();
    expect(status.overdue).toBe(false);
    expect(status.status).toBe('pass');
    expect(status.days_since_drill).toBe(10);
  });

  it('returns overdue=true when last drill was more than 90 days ago', async () => {
    const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000); // 95 days ago
    db.query.mockResolvedValue([[
      { run_at: oldDate, status: 'pass', error_message: null },
    ]]);
    const status = await drDrillService.getDrillStatus();
    expect(status.overdue).toBe(true);
    expect(status.days_since_drill).toBeGreaterThanOrEqual(95);
  });

  it('returns overdue=true when last drill failed regardless of date', async () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    db.query.mockResolvedValue([[
      { run_at: recentDate, status: 'fail', error_message: 'FK orphans detected' },
    ]]);
    const status = await drDrillService.getDrillStatus();
    expect(status.overdue).toBe(true);
    expect(status.last_error).toBe('FK orphans detected');
  });

  it('returns overdue=true when last drill had status=error', async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    db.query.mockResolvedValue([[
      { run_at: recentDate, status: 'error', error_message: 'mysqldump not found' },
    ]]);
    const status = await drDrillService.getDrillStatus();
    expect(status.overdue).toBe(true);
  });
});

