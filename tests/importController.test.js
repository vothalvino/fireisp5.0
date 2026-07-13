// =============================================================================
// FireISP 5.0 — Import Controller Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn(), getConnection: jest.fn() }));

const db = require('../src/config/database');
const {
  parseCsv,
  parseCsvLine,
  parseUploadedFile,
  importClients,
  importDevices,
  importContracts,
  importClientsFile,
  importDevicesFile,
  importContractsFile,
  importInvoices,
  importInvoicesFile,
  importPayments,
  importPaymentsFile,
} = require('../src/controllers/importController');

function mockReqRes(overrides = {}) {
  const req = { orgId: 1, body: {}, ...overrides };
  const res = {
    set: jest.fn().mockReturnThis(),
    send: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

/**
 * Fresh mock transaction connection for importContracts/importContractsFile,
 * matching the shape db.getConnection() resolves to. `query` is SQL-pattern
 * matched (rather than a positional mockResolvedValueOnce chain) because
 * insertContractRow issues a different number of queries depending on
 * connection_type (pppoe/pppoe_dual provision a RADIUS account; static/dual
 * do not).
 */
function makeContractConn({ insertId = 10, radiusUsernameTaken = false, ipPoolId = null } = {}) {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockImplementation((sql) => {
      if (/^INSERT INTO contracts/.test(sql)) return Promise.resolve([{ insertId }]);
      if (/^SELECT name FROM clients/.test(sql)) return Promise.resolve([[{ name: 'Alice' }]]);
      if (/^SELECT id FROM radius WHERE username/.test(sql)) {
        return Promise.resolve([radiusUsernameTaken ? [{ id: 1 }] : []]);
      }
      if (/^SELECT id FROM ip_pools/.test(sql)) return Promise.resolve([ipPoolId ? [{ id: ipPoolId }] : []]);
      if (/^INSERT INTO radius/.test(sql)) return Promise.resolve([{ insertId: 55 }]);
      if (/^UPDATE contracts SET status/.test(sql)) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[]]);
    }),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

describe('importController', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // parseCsv
  // ---------------------------------------------------------------------------
  describe('parseCsv', () => {
    test('parses simple CSV into objects', () => {
      const csv = 'name,email\nAlice,a@b.com\nBob,b@c.com';
      const rows = parseCsv(csv);
      expect(rows).toEqual([
        { name: 'Alice', email: 'a@b.com' },
        { name: 'Bob', email: 'b@c.com' },
      ]);
    });

    test('handles quoted fields', () => {
      const csv = 'name,city\n"Alice","New York"';
      const rows = parseCsv(csv);
      expect(rows[0].city).toBe('New York');
    });

    test('handles escaped quotes inside fields', () => {
      const csv = 'note\n"She said ""hi"""\n';
      const rows = parseCsv(csv);
      expect(rows[0].note).toBe('She said "hi"');
    });

    test('returns empty array for header-only CSV', () => {
      expect(parseCsv('name,email')).toEqual([]);
    });

    test('respects 10000 row limit', () => {
      const header = 'a';
      const dataLines = Array.from({ length: 10500 }, () => 'x');
      const csv = [header, ...dataLines].join('\n');
      const rows = parseCsv(csv);
      expect(rows.length).toBe(10000);
    });
  });

  // ---------------------------------------------------------------------------
  // parseCsvLine
  // ---------------------------------------------------------------------------
  describe('parseCsvLine', () => {
    test('splits simple line on commas', () => {
      expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    test('handles quoted fields containing commas', () => {
      expect(parseCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
    });

    test('handles escaped quotes inside quoted fields', () => {
      expect(parseCsvLine('"say ""hi""",ok')).toEqual(['say "hi"', 'ok']);
    });

    test('respects 200 column limit', () => {
      const line = Array.from({ length: 250 }, (_, i) => `v${i}`).join(',');
      const result = parseCsvLine(line);
      expect(result.length).toBeLessThanOrEqual(200);
    });
  });

  // ---------------------------------------------------------------------------
  // importClients
  // ---------------------------------------------------------------------------
  describe('importClients', () => {
    test('returns 422 when csv field is missing', async () => {
      const { req, res, next } = mockReqRes({ body: {} });
      await importClients(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }),
      );
    });

    test('imports valid rows and returns counts', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name,email\nAlice Smith,a@b.com\nBob Jones,b@c.com';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importClients(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        data: { imported: 2, total: 2, errors: [] },
      });
    });

    test('tracks errors for rows missing required fields', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name\n\nBob Jones';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importClients(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({ row: 2, error: expect.stringContaining('required') }),
      );
    });

    test('returns imported, total, and errors in response', async () => {
      const dbError = new Error('duplicate');
      db.query.mockRejectedValueOnce(dbError).mockResolvedValueOnce([{ insertId: 2 }]);
      const csv = 'name\nAlice Smith\nBob Jones';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importClients(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(1);
      expect(result.total).toBe(2);
      expect(result.errors.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // importDevices
  // ---------------------------------------------------------------------------
  describe('importDevices', () => {
    test('returns 422 when csv field is missing', async () => {
      const { req, res, next } = mockReqRes({ body: {} });
      await importDevices(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('imports valid rows', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name,ip_address,type\nRouter1,10.0.0.1,router';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importDevices(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        data: { imported: 1, total: 1, errors: [] },
      });
    });

    test('validates required fields name and ip_address', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name,ip_address\n,10.0.0.1\nRouter2,';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importDevices(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // importContracts
  // ---------------------------------------------------------------------------
  describe('importContracts', () => {
    test('returns 422 when csv field is missing', async () => {
      const { req, res, next } = mockReqRes({ body: {} });
      await importContracts(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('imports a pppoe row, defaults connection_type, provisions RADIUS, and activates the contract', async () => {
      // Client.findById + assertPlanSelectable pre-checks (org-verify
      // hardening) both go through the pooled db.query, not conn.query —
      // a truthy row satisfies both (client found / plan found).
      db.query.mockResolvedValue([[{ id: 1 }]]);
      const conn = makeContractConn({ insertId: 7 });
      db.getConnection.mockResolvedValue(conn);
      const csv = 'client_id,plan_id,start_date\n1,2,2024-01-01';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importContracts(req, res, next);

      const result = res.json.mock.calls[0][0].data;
      expect(result).toEqual({
        imported: 1,
        total: 1,
        errors: [],
        credentials: [{ row: 2, contract_id: 7, username: expect.any(String) }],
      });
      // Insert as 'pending', provision RADIUS, then flip to 'active' — never
      // a single-statement INSERT with status='active' (see migration 128:
      // trg_contracts_radius_consistency_bu only fires on UPDATE).
      expect(conn.query).toHaveBeenCalledWith(expect.stringMatching(/^INSERT INTO contracts/), expect.arrayContaining(['pending']));
      expect(conn.query).toHaveBeenCalledWith(expect.stringMatching(/^INSERT INTO radius/), expect.any(Array));
      expect(conn.query).toHaveBeenCalledWith(expect.stringMatching(/^UPDATE contracts SET status = 'active'/), [7]);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(conn.rollback).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalledTimes(1);
    });

    test('imports a static row without provisioning a RADIUS account', async () => {
      db.query.mockResolvedValue([[{ id: 1 }]]);
      const conn = makeContractConn({ insertId: 8 });
      db.getConnection.mockResolvedValue(conn);
      const csv = 'client_id,plan_id,connection_type\n1,2,static';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importContracts(req, res, next);

      const result = res.json.mock.calls[0][0].data;
      expect(result).toEqual({ imported: 1, total: 1, errors: [], credentials: [] });
      expect(conn.query).not.toHaveBeenCalledWith(expect.stringMatching(/^INSERT INTO radius/), expect.anything());
      expect(conn.commit).toHaveBeenCalledTimes(1);
    });

    test('rejects an invalid connection_type as a per-row error, without touching the DB', async () => {
      const { req, res, next } = mockReqRes({ body: { csv: 'client_id,plan_id,connection_type\n1,2,fiber' } });
      await importContracts(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({ row: 2, error: expect.stringMatching(/connection_type must be one of/) }),
      );
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test('validates required fields client_id and plan_id', async () => {
      const csv = 'client_id,plan_id\n,2\n1,';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importContracts(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test('rolls back the transaction and reports the error when provisioning fails', async () => {
      db.query.mockResolvedValue([[{ id: 1 }]]);
      const conn = makeContractConn({ insertId: 9 });
      conn.query.mockImplementation((sql) => {
        if (/^INSERT INTO contracts/.test(sql)) return Promise.resolve([{ insertId: 9 }]);
        if (/^SELECT name FROM clients/.test(sql)) return Promise.reject(new Error('connection lost'));
        return Promise.resolve([[]]);
      });
      db.getConnection.mockResolvedValue(conn);
      const csv = 'client_id,plan_id\n1,2';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importContracts(req, res, next);

      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0]).toEqual(expect.objectContaining({ row: 2, error: 'connection lost' }));
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalledTimes(1);
    });

    // Security hardening: the CSV importer previously accepted client_id and
    // plan_id with ZERO org-verification (worse than the JSON POST /contracts
    // route, which at least org-verified plan_id). A cross-org FK must now
    // error THAT row without aborting the rest of the CSV loop.
    describe('org-verify hardening (client_id/plan_id)', () => {
      test('a cross-org client_id errors the row without touching the transactional DB', async () => {
        db.query.mockResolvedValueOnce([[]]); // Client.findById — not found in this org
        const csv = 'client_id,plan_id\n1,2';
        const { req, res, next } = mockReqRes({ body: { csv } });
        await importContracts(req, res, next);

        const result = res.json.mock.calls[0][0].data;
        expect(result.imported).toBe(0);
        expect(result.errors[0]).toEqual(
          expect.objectContaining({ row: 2, error: expect.stringContaining('does not belong to this organization') }),
        );
        expect(db.getConnection).not.toHaveBeenCalled();
      });

      test('a cross-org plan_id errors the row without touching the transactional DB', async () => {
        db.query
          .mockResolvedValueOnce([[{ id: 1 }]])  // Client.findById — found
          .mockResolvedValueOnce([[]]);           // assertPlanSelectable — plan not in this org
        const csv = 'client_id,plan_id\n1,2';
        const { req, res, next } = mockReqRes({ body: { csv } });
        await importContracts(req, res, next);

        const result = res.json.mock.calls[0][0].data;
        expect(result.imported).toBe(0);
        expect(result.errors[0].row).toBe(2);
        expect(result.errors[0].error).toMatch(/archived|unavailable|different organization/);
        expect(db.getConnection).not.toHaveBeenCalled();
      });

      test('a cross-org client_id on one row does not abort a later valid row in the same CSV', async () => {
        db.query
          .mockResolvedValueOnce([[]])            // row 1: Client.findById — not found (cross-org)
          .mockResolvedValueOnce([[{ id: 2 }]])   // row 2: Client.findById — found
          .mockResolvedValueOnce([[{ id: 5 }]]);  // row 2: assertPlanSelectable — found
        const conn = makeContractConn({ insertId: 20 });
        db.getConnection.mockResolvedValue(conn);
        const csv = 'client_id,plan_id,connection_type\n999,5,static\n2,5,static';
        const { req, res, next } = mockReqRes({ body: { csv } });
        await importContracts(req, res, next);

        const result = res.json.mock.calls[0][0].data;
        expect(result.imported).toBe(1);
        expect(result.errors).toEqual([
          expect.objectContaining({ row: 2, error: expect.stringContaining('does not belong to this organization') }),
        ]);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // parseUploadedFile
  // ---------------------------------------------------------------------------
  describe('parseUploadedFile', () => {
    test('parses a CSV buffer into row objects', () => {
      const csv = 'a,b\n1,2';
      const rows = parseUploadedFile(Buffer.from(csv));
      expect(rows).toEqual([{ a: '1', b: '2' }]);
    });

    test('returns empty array for header-only buffer', () => {
      const rows = parseUploadedFile(Buffer.from('a,b\n'));
      expect(rows).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // importClientsFile
  // ---------------------------------------------------------------------------
  describe('importClientsFile', () => {
    test('returns 422 when no file is provided', async () => {
      const { req, res, next } = mockReqRes({ file: null });
      await importClientsFile(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }),
      );
    });

    test('imports clients from a CSV buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name,email\nAlice Smith,a@b.com';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'clients.csv' },
      });
      await importClientsFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('tracks validation errors for rows missing required fields', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name\n\nBob Jones';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'clients.csv' },
      });
      await importClientsFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({ row: 2, error: expect.stringContaining('required') }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // importDevicesFile
  // ---------------------------------------------------------------------------
  describe('importDevicesFile', () => {
    test('returns 422 when no file is provided', async () => {
      const { req, res, next } = mockReqRes({ file: null });
      await importDevicesFile(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('imports devices from a CSV file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name,ip_address,type\nRouter1,10.0.0.1,router';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'devices.csv' },
      });
      await importDevicesFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('validates required fields name and ip_address', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'name,ip_address\n,10.0.0.1\nRouter2,';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'devices.csv' },
      });
      await importDevicesFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // importContractsFile
  // ---------------------------------------------------------------------------
  describe('importContractsFile', () => {
    test('returns 422 when no file is provided', async () => {
      const { req, res, next } = mockReqRes({ file: null });
      await importContractsFile(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('imports a pppoe_dual contract from a CSV file buffer, provisioning RADIUS', async () => {
      db.query.mockResolvedValue([[{ id: 1 }]]);
      const conn = makeContractConn({ insertId: 3 });
      db.getConnection.mockResolvedValue(conn);
      const csv = 'client_id,plan_id,start_date,connection_type\n1,2,2024-01-01,pppoe_dual';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'contracts.csv' },
      });
      await importContractsFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result).toEqual({
        imported: 1,
        total: 1,
        errors: [],
        credentials: [{ row: 2, contract_id: 3, username: expect.any(String) }],
      });
      expect(conn.commit).toHaveBeenCalledTimes(1);
    });

    test('validates required fields client_id and plan_id', async () => {
      const csv = 'client_id,plan_id\n,2\n1,';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'contracts.csv' },
      });
      await importContractsFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test('rejects an invalid connection_type as a per-row error', async () => {
      const csv = 'client_id,plan_id,connection_type\n1,2,cable';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'contracts.csv' },
      });
      await importContractsFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0].error).toMatch(/connection_type must be one of/);
    });
  });

  // ---------------------------------------------------------------------------
  // importInvoices
  // ---------------------------------------------------------------------------
  describe('importInvoices', () => {
    test('returns 422 when csv field is missing', async () => {
      const { req, res, next } = mockReqRes({ body: {} });
      await importInvoices(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }),
      );
    });

    test('imports valid rows and returns counts', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date,subtotal,total\n1,INV-001,2024-01-01,2024-01-31,100,116';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importInvoices(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('validates required fields', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date\n,INV-002,2024-01-01,2024-01-31\n1,,2024-01-01,2024-01-31';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importInvoices(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
    });

    test('rejects invalid status', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date,status\n1,INV-003,2024-01-01,2024-01-31,unknown';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importInvoices(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0].error).toMatch(/status must be one of/);
    });

    test('defaults status to draft when not provided', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date\n1,INV-004,2024-01-01,2024-01-31';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importInvoices(req, res, next);
      const callArgs = db.query.mock.calls[0][1];
      expect(callArgs[callArgs.length - 1]).toBe('draft');
    });

    test('calculates tax_amount and total from subtotal and tax_rate', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date,subtotal,tax_rate\n1,INV-005,2024-01-01,2024-01-31,100,0.16';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importInvoices(req, res, next);
      const args = db.query.mock.calls[0][1];
      expect(args[5]).toBe(100);   // subtotal
      expect(args[6]).toBe(0.16);  // tax_rate
      expect(args[7]).toBe(16);    // tax_amount
      expect(args[8]).toBe(116);   // total
    });

    test('tracks db errors per row', async () => {
      db.query.mockRejectedValueOnce(new Error('duplicate key')).mockResolvedValueOnce([{ insertId: 2 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date\n1,INV-DUP,2024-01-01,2024-01-31\n2,INV-006,2024-01-01,2024-01-31';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importInvoices(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error).toMatch(/duplicate key/);
    });
  });

  // ---------------------------------------------------------------------------
  // importInvoicesFile
  // ---------------------------------------------------------------------------
  describe('importInvoicesFile', () => {
    test('returns 422 when no file is provided', async () => {
      const { req, res, next } = mockReqRes({ file: null });
      await importInvoicesFile(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('imports invoices from a CSV file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date\n1,INV-007,2024-01-01,2024-01-31';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'invoices.csv' },
      });
      await importInvoicesFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('validates required fields in file upload', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_number,issue_date,due_date\n,INV-010,2024-01-01,2024-01-31';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'invoices.csv' },
      });
      await importInvoicesFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0].error).toMatch(/client_id is required/);
    });
  });

  // ---------------------------------------------------------------------------
  // importPayments
  // ---------------------------------------------------------------------------
  describe('importPayments', () => {
    test('returns 422 when csv field is missing', async () => {
      const { req, res, next } = mockReqRes({ body: {} });
      await importPayments(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }),
      );
    });

    test('imports valid rows and returns counts', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,amount,payment_date,payment_method\n1,500.00,2024-01-15,cash';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importPayments(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('validates required fields', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,amount,payment_date\n,500.00,2024-01-15\n1,,2024-01-15\n1,500.00,';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importPayments(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(3);
    });

    test('rejects invalid payment_method', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,amount,payment_date,payment_method\n1,100,2024-01-15,bitcoin';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importPayments(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0].error).toMatch(/payment_method must be one of/);
    });

    test('rejects non-positive amount', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,amount,payment_date\n1,-50,2024-01-15';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importPayments(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0].error).toMatch(/positive/);
    });

    test('defaults payment_method to cash when not provided', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,amount,payment_date\n1,200,2024-01-15';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importPayments(req, res, next);
      const callArgs = db.query.mock.calls[0][1];
      expect(callArgs[4]).toBe('cash');
    });

    test('stores optional fields correctly', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,invoice_id,amount,payment_date,payment_method,reference_number,notes\n1,42,300.00,2024-01-15,spei,REF-XYZ,some note';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importPayments(req, res, next);
      const args = db.query.mock.calls[0][1];
      expect(args[1]).toBe('42');      // invoice_id
      expect(args[6]).toBe('REF-XYZ'); // reference_number
      expect(args[9]).toBe('some note'); // notes
    });

    test('tracks db errors per row', async () => {
      db.query.mockRejectedValueOnce(new Error('FK violation')).mockResolvedValueOnce([{ insertId: 2 }]);
      const csv = 'client_id,amount,payment_date\n999,100,2024-01-15\n1,200,2024-01-16';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importPayments(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(1);
      expect(result.errors.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // importPaymentsFile
  // ---------------------------------------------------------------------------
  describe('importPaymentsFile', () => {
    test('returns 422 when no file is provided', async () => {
      const { req, res, next } = mockReqRes({ file: null });
      await importPaymentsFile(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('imports payments from a CSV file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,amount,payment_date,payment_method\n1,150.00,2024-01-20,bank_transfer';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'payments.csv' },
      });
      await importPaymentsFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('validates required fields in file upload', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,amount,payment_date\n1,,2024-01-20';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'payments.csv' },
      });
      await importPaymentsFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0].error).toMatch(/amount is required/);
    });
  });
});
