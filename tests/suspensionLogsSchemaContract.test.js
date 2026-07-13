// =============================================================================
// FireISP 5.0 — suspension_logs write contract
// =============================================================================
// These tests pin the EXACT columns and values every suspension path writes.
//
// Background: all four `INSERT INTO suspension_logs` statements in the codebase
// named columns that do not exist (`performed_by`, `invoice_id`, `coa_sent`,
// `coa_response`) and wrote `action` values that are not in the ENUM
// ('suspend', 'unsuspend', 'soft_suspend', 'walled_garden'). Every suspend,
// reconnect, soft-suspend and walled-garden call therefore 500'd in production —
// including the auto-reconnect that runs when a customer pays. The jest suite
// never noticed because the DB is mocked.
//
// So: assert against the REAL table (database/schema.sql), not against whatever
// the service happens to send. Reintroducing any of the old column names, or an
// action value outside the ENUM, must fail here.
// =============================================================================

const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const suspensionService = require('../src/services/suspensionService');
const radiusService = require('../src/services/radiusService');
const { parseSchema } = require('../src/scripts/sql-column-check');

const SCHEMA = parseSchema(
  fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'),
).get('suspension_logs');

/** Column list of an `INSERT INTO suspension_logs (a, b, c) …` statement. */
function insertedColumns(sql) {
  const m = /INSERT\s+INTO\s+suspension_logs\s*\(([\s\S]*?)\)/i.exec(sql);
  if (!m) throw new Error(`not an INSERT INTO suspension_logs:\n${sql}`);
  return m[1].split(',').map((c) => c.trim());
}

/** The SQL literal written to `action` in an INSERT ... SELECT projection. */
function insertedAction(sql) {
  const cols = insertedColumns(sql);
  const idx = cols.indexOf('action');
  expect(idx).toBeGreaterThanOrEqual(0);
  const projection = /SELECT\s+([\s\S]*?)\s+FROM/i.exec(sql)[1];
  const exprs = projection.split(/,(?![^(]*\))/).map((e) => e.trim());
  return exprs[idx].replace(/^'|'$/g, '');
}

const calls = (mockFn, needle) =>
  mockFn.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes(needle));

describe('suspension_logs write contract', () => {
  let conn;

  beforeEach(() => {
    jest.clearAllMocks();
    conn = {
      beginTransaction: jest.fn(),
      execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);
    db.query.mockResolvedValue([[]]);
  });

  test('the schema fixture itself is what we think it is', () => {
    // If this fails, the table changed and every expectation below must be revisited.
    expect(SCHEMA).toBeDefined();
    expect([...SCHEMA.enums.get('action')]).toEqual(
      ['suspended', 'unsuspended', 'disconnected', 'reconnected'],
    );
    expect([...SCHEMA.enums.get('triggered_by')]).toEqual(['system', 'manual']);
    for (const required of ['contract_id', 'client_id', 'action', 'triggered_by', 'suspended_at']) {
      expect(SCHEMA.columns.has(required)).toBe(true);
    }
    // The four columns the service used to write, which have never existed:
    for (const bogus of ['performed_by', 'invoice_id', 'coa_sent', 'coa_response']) {
      expect(SCHEMA.columns.has(bogus)).toBe(false);
    }
  });

  describe('suspendContract', () => {
    beforeEach(() => {
      // isClientSuspensionExempt → not exempt; then the RADIUS lookup → no account.
      db.query
        .mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]])
        .mockResolvedValueOnce([[]]);
    });

    test('writes only columns that exist, with an ENUM-legal action', async () => {
      await suspensionService.suspendContract(10, 3, 5, 50);

      const [sql, params] = calls(conn.execute, 'INSERT INTO suspension_logs')[0];
      for (const col of insertedColumns(sql)) {
        expect(SCHEMA.columns.has(col)).toBe(true);
      }
      expect(insertedAction(sql)).toBe('suspended');
      expect(SCHEMA.enums.get('action').has(insertedAction(sql))).toBe(true);

      // Column names that must never come back.
      expect(sql).not.toMatch(/\bperformed_by\b(?!_user_id)/);
      expect(sql).not.toMatch(/\bcoa_sent\b/);
      expect(sql).not.toMatch(/\bcoa_response\b/);
      expect(sql).not.toMatch(/[(,]\s*invoice_id\b/);

      // client_id is NOT NULL and is taken from the contract itself.
      expect(insertedColumns(sql)).toContain('client_id');
      expect(sql).toMatch(/SELECT\s+c\.id,\s*c\.client_id/i);
      expect(sql).toMatch(/FROM\s+contracts\s+c/i);
      expect(params[params.length - 1]).toBe(10);          // WHERE c.id = ?

      // Renamed equivalents carry the values.
      expect(params).toContain(3);                          // suspension_rule_id
      expect(params).toContain(5);                          // performed_by_user_id
      expect(params).toContain(50);                         // related_invoice_id
    });

    test('triggered_by is manual when a user did it', async () => {
      await suspensionService.suspendContract(10, null, 5, null);
      const [sql, params] = calls(conn.execute, 'INSERT INTO suspension_logs')[0];
      const idx = insertedColumns(sql).indexOf('triggered_by');
      // columns → SELECT projection is positional; params fill the '?' placeholders
      // in projection order, so triggered_by is the 2nd bound param here.
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(params).toContain('manual');
      expect(params).not.toContain('system');
    });

    test('triggered_by is system when the scheduler did it (no user id)', async () => {
      await suspensionService.suspendContract(10, 3, null, 50);
      const [, params] = calls(conn.execute, 'INSERT INTO suspension_logs')[0];
      expect(params).toContain('system');
      expect(params).not.toContain('manual');
    });

    test('every bound value is a legal ENUM value where the column is an ENUM', async () => {
      await suspensionService.suspendContract(10, 3, 5, 50);
      const [, params] = calls(conn.execute, 'INSERT INTO suspension_logs')[0];
      const triggeredBy = params.find((p) => p === 'manual' || p === 'system');
      expect(SCHEMA.enums.get('triggered_by').has(triggeredBy)).toBe(true);
    });
  });

  describe('reconnectContract', () => {
    test('writes an ENUM-legal unsuspended row and fills the NOT NULL suspended_at', async () => {
      // RADIUS lookup → none; then the open-walled-garden lookup → none.
      db.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
      const originalSuspension = new Date('2026-07-01T10:00:00Z');
      conn.execute.mockImplementation((sql) => {
        if (/SELECT suspended_at/i.test(sql)) return [[{ suspended_at: originalSuspension }]];
        return [{ affectedRows: 1 }];
      });

      await suspensionService.reconnectContract(10, 5, 50);

      const [sql, params] = calls(conn.execute, 'INSERT INTO suspension_logs')[0];
      for (const col of insertedColumns(sql)) {
        expect(SCHEMA.columns.has(col)).toBe(true);
      }
      expect(insertedAction(sql)).toBe('unsuspended');
      expect(SCHEMA.enums.get('action').has('unsuspended')).toBe(true);
      expect(sql).not.toMatch(/'unsuspend'/);
      expect(sql).not.toMatch(/\bperformed_by\b(?!_user_id)/);

      // suspended_at is NOT NULL: the original suspension time is recovered.
      expect(insertedColumns(sql)).toContain('suspended_at');
      expect(insertedColumns(sql)).toContain('restored_at');
      expect(params).toContain(originalSuspension);
      expect(params).toContain('manual');
    });

    test('falls back to NOW() when there is no prior suspension row', async () => {
      db.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
      conn.execute.mockImplementation((sql) => {
        if (/SELECT suspended_at/i.test(sql)) return [[]];
        return [{ affectedRows: 1 }];
      });

      await suspensionService.reconnectContract(10, null, null);

      const [sql, params] = calls(conn.execute, 'INSERT INTO suspension_logs')[0];
      expect(sql).toMatch(/COALESCE\(\?,\s*NOW\(\)\)/i);
      expect(params).toContain(null);
      expect(params).toContain('system');           // no user id → scheduler
    });

    test('closes the open suspension row but leaves walled-garden rows open', async () => {
      db.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
      await suspensionService.reconnectContract(10, 5, 50);

      const [sql] = calls(conn.execute, 'UPDATE suspension_logs')[0];
      expect(sql).toMatch(/restored_at = NOW\(\)/i);
      expect(sql).toMatch(/action = 'suspended'/);
      expect(sql).toMatch(/NOT LIKE 'walled\\_garden:%'/);
    });
  });

  describe('softSuspendContract', () => {
    test("uses action 'suspended' (service degraded, not cut) with a soft_suspend reason", async () => {
      db.query
        .mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]])
        .mockResolvedValueOnce([[]])                 // RADIUS lookup
        .mockResolvedValueOnce([{ insertId: 1 }]);   // the INSERT

      await suspensionService.softSuspendContract(10, 3, 5, 50, 512, 128);

      const [sql, params] = calls(db.query, 'INSERT INTO suspension_logs')[0];
      for (const col of insertedColumns(sql)) {
        expect(SCHEMA.columns.has(col)).toBe(true);
      }
      expect(insertedAction(sql)).toBe('suspended');
      expect(sql).not.toMatch(/'soft_suspend'/);     // never an ENUM value
      expect(params.some((p) => typeof p === 'string' && p.startsWith('soft_suspend:'))).toBe(true);
      expect(insertedColumns(sql)).toContain('client_id');
    });
  });

  describe('walledGardenSuspendContract (radiusService)', () => {
    test("uses action 'suspended' with a walled_garden: reason prefix", async () => {
      db.query
        .mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]])
        .mockResolvedValueOnce([[]])                 // RADIUS lookup for CoA
        .mockResolvedValueOnce([{ insertId: 1 }])    // the INSERT
        .mockResolvedValueOnce([[]]);                // org lookup for the re-sync

      await radiusService.walledGardenSuspendContract(10, 3, 5, 50);

      const [sql, params] = calls(db.query, 'INSERT INTO suspension_logs')[0];
      for (const col of insertedColumns(sql)) {
        expect(SCHEMA.columns.has(col)).toBe(true);
      }
      expect(insertedAction(sql)).toBe('suspended');
      expect(sql).not.toMatch(/'walled_garden'/);    // never an ENUM value
      expect(params.some((p) => typeof p === 'string' && p.startsWith('walled_garden:'))).toBe(true);
    });

    test('walledGardenReconnect closes rows via the reason prefix, not a bogus action', async () => {
      db.query.mockResolvedValue([[]]);
      await radiusService.walledGardenReconnect(10, 5);

      const [sql] = calls(db.query, 'UPDATE suspension_logs')[0];
      expect(sql).toMatch(/restored_at = NOW\(\)/i);
      expect(sql).toMatch(/action = 'suspended'/);
      expect(sql).toMatch(/LIKE 'walled\\_garden:%'/);
      expect(sql).not.toMatch(/action = 'walled_garden'/);
    });
  });
});
