// =============================================================================
// FireISP 5.0 — Deep Domain Controller Tests (Edge-cases & Error Paths)
// =============================================================================
// Complements domainControllers.test.js with edge-case, error-path, and
// boundary coverage for billingController, dashboardController,
// exportController, and importController.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/billingService', () => ({
  generateBillingPeriod: jest.fn(),
  generateInvoice: jest.fn(),
  recordPaymentCredit: jest.fn(),
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');

const billingController = require('../src/controllers/billingController');
const dashboardController = require('../src/controllers/dashboardController');
const exportController = require('../src/controllers/exportController');
const importController = require('../src/controllers/importController');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockReq = (body = {}, params = {}, query = {}, orgId = 1, user = { id: 1 }) => ({
  body, params, query, orgId, user,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let mockConnection;

beforeEach(() => {
  jest.clearAllMocks();
  mockConnection = {
    beginTransaction: jest.fn(),
    execute: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  db.getConnection.mockResolvedValue(mockConnection);
});

// ===========================================================================
// 1. billingController
// ===========================================================================
describe('billingController — deep', () => {
  // -------------------------------------------------------------------------
  // generatePeriod
  // -------------------------------------------------------------------------
  describe('generatePeriod', () => {
    test('returns 404 when contract not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await billingController.generatePeriod(mockReq({ contract_id: 999 }), res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'NOT_FOUND' }) }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('calls next(err) on DB error during contract lookup', async () => {
      const dbErr = new Error('connection lost');
      db.query.mockRejectedValueOnce(dbErr);
      const res = mockRes();

      await billingController.generatePeriod(mockReq({ contract_id: 1 }), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(dbErr);
    });

    test('calls next(err) when billingService.generateBillingPeriod throws', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, organization_id: 1 }]]);
      billingService.generateBillingPeriod.mockRejectedValueOnce(new Error('service boom'));
      const res = mockRes();

      await billingController.generatePeriod(mockReq({ contract_id: 1 }), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'service boom' }));
    });
  });

  // -------------------------------------------------------------------------
  // generateInvoice
  // -------------------------------------------------------------------------
  describe('generateInvoice', () => {
    test('returns 404 when contract not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await billingController.generateInvoice(mockReq({ contract_id: 777 }), res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ message: 'Contract not found' }) }),
      );
    });

    test('returns 404 when plan not found', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, plan_id: 99, organization_id: 1 }]])
        .mockResolvedValueOnce([[]]);
      const res = mockRes();

      await billingController.generateInvoice(mockReq({ contract_id: 1 }), res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ message: 'Plan not found' }) }),
      );
    });

    test('calls next(err) on DB error fetching plan', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, plan_id: 5, organization_id: 1 }]])
        .mockRejectedValueOnce(new Error('plan query failed'));
      const res = mockRes();

      await billingController.generateInvoice(mockReq({ contract_id: 1 }), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'plan query failed' }));
    });
  });

  // -------------------------------------------------------------------------
  // allocatePayment
  // -------------------------------------------------------------------------
  describe('allocatePayment', () => {
    test('returns 404 when payment not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const res = mockRes();

      await billingController.allocatePayment(
        mockReq({ payment_id: 999, allocations: [] }),
        res,
        mockNext,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ message: 'Payment not found' }) }),
      );
    });

    test('marks invoice as paid when fully paid', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, currency: 'MXN', organization_id: 1 }]]);

      mockConnection.execute
        .mockResolvedValueOnce([{ insertId: 100 }])                       // INSERT allocation
        .mockResolvedValueOnce([[{ paid: '500.00' }]])                     // SUM paid
        .mockResolvedValueOnce([[{ total: '500.00' }]])                    // invoice total
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                     // UPDATE status

      billingService.recordPaymentCredit.mockResolvedValueOnce();

      const req = mockReq({
        payment_id: 1,
        allocations: [{ invoice_id: 10, amount: 500 }],
      });
      const res = mockRes();

      await billingController.allocatePayment(req, res, mockNext);

      expect(mockConnection.commit).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      // Verify the UPDATE was issued
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'UPDATE invoices SET status = ? WHERE id = ?',
        ['paid', 10],
      );
    });

    test('does NOT mark invoice as paid when partially paid', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, currency: 'USD', organization_id: 1 }]]);

      mockConnection.execute
        .mockResolvedValueOnce([{ insertId: 101 }])                       // INSERT allocation
        .mockResolvedValueOnce([[{ paid: '200.00' }]])                     // SUM paid
        .mockResolvedValueOnce([[{ total: '500.00' }]]);                   // invoice total (not fully paid)

      billingService.recordPaymentCredit.mockResolvedValueOnce();

      const req = mockReq({
        payment_id: 1,
        allocations: [{ invoice_id: 10, amount: 200 }],
      });
      const res = mockRes();

      await billingController.allocatePayment(req, res, mockNext);

      expect(mockConnection.commit).toHaveBeenCalled();
      // Only 3 execute calls (INSERT, SUM, SELECT total) — no UPDATE
      expect(mockConnection.execute).toHaveBeenCalledTimes(3);
    });

    test('rolls back transaction on allocation error', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, currency: 'MXN', organization_id: 1 }]]);
      mockConnection.execute.mockRejectedValueOnce(new Error('insert failed'));

      const req = mockReq({
        payment_id: 1,
        allocations: [{ invoice_id: 10, amount: 100 }],
      });
      const res = mockRes();

      await billingController.allocatePayment(req, res, mockNext);

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'insert failed' }));
    });

    test('rolls back when recordPaymentCredit fails', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, currency: 'MXN', organization_id: 1 }]]);

      mockConnection.execute
        .mockResolvedValueOnce([{ insertId: 200 }])
        .mockResolvedValueOnce([[{ paid: '100.00' }]])
        .mockResolvedValueOnce([[{ total: '500.00' }]]);

      billingService.recordPaymentCredit.mockRejectedValueOnce(new Error('credit boom'));

      const req = mockReq({
        payment_id: 1,
        allocations: [{ invoice_id: 10, amount: 100 }],
      });
      const res = mockRes();

      await billingController.allocatePayment(req, res, mockNext);

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'credit boom' }));
    });
  });

  // -------------------------------------------------------------------------
  // bulkGenerate
  // -------------------------------------------------------------------------
  describe('bulkGenerate', () => {
    test('handles individual contract errors gracefully', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, plan_name: 'A', plan_price: 100, plan_currency: 'MXN', organization_id: 1 },
        { id: 2, plan_name: 'B', plan_price: 200, plan_currency: 'MXN', organization_id: 1 },
        { id: 3, plan_name: 'C', plan_price: 300, plan_currency: 'MXN', organization_id: 1 },
      ]]);

      billingService.generateBillingPeriod
        .mockResolvedValueOnce({ status: 'pending' })   // contract 1 OK
        .mockRejectedValueOnce(new Error('dup period'))  // contract 2 FAILS
        .mockResolvedValueOnce({ status: 'pending' });   // contract 3 OK

      billingService.generateInvoice
        .mockResolvedValueOnce({ id: 50 })
        .mockResolvedValueOnce({ id: 52 });

      const res = mockRes();
      await billingController.bulkGenerate(mockReq(), res, mockNext);

      const result = res.json.mock.calls[0][0].data;
      expect(result.generated).toBe(2);
      expect(result.total_contracts).toBe(3);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({ contract_id: 2, error: 'dup period' }),
      );
    });

    test('returns zero generated when no active contracts exist', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const res = mockRes();

      await billingController.bulkGenerate(mockReq(), res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        data: { generated: 0, total_contracts: 0, errors: [] },
      });
    });

    test('skips invoice generation when period status is not pending', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, plan_name: 'A', plan_price: 100, plan_currency: 'MXN', organization_id: 1 },
      ]]);
      billingService.generateBillingPeriod.mockResolvedValueOnce({ status: 'already_billed' });

      const res = mockRes();
      await billingController.bulkGenerate(mockReq(), res, mockNext);

      expect(billingService.generateInvoice).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        data: { generated: 0, total_contracts: 1, errors: [] },
      });
    });

    test('calls next(err) when initial contract query fails', async () => {
      db.query.mockRejectedValueOnce(new Error('db down'));
      const res = mockRes();

      await billingController.bulkGenerate(mockReq(), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }));
    });
  });
});

// ===========================================================================
// 2. dashboardController
// ===========================================================================
describe('dashboardController — deep', () => {
  // -------------------------------------------------------------------------
  // summary
  // -------------------------------------------------------------------------
  describe('summary', () => {
    test('returns correct structure with zero/empty data', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ total: 0, active: 0 }]])
        .mockResolvedValueOnce([[{ total: 0, active: 0, suspended: 0 }]])
        .mockResolvedValueOnce([[{ outstanding: 0, collected: 0, total_invoiced: 0 }]])
        .mockResolvedValueOnce([[{ total: 0, open_count: 0 }]])
        .mockResolvedValueOnce([[{ total: 0, monitored: 0 }]]);

      const res = mockRes();
      await dashboardController.summary(mockReq(), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data).toEqual({
        clients: { total: 0, active: 0 },
        contracts: { total: 0, active: 0, suspended: 0 },
        revenue_30d: { outstanding: 0, collected: 0, total_invoiced: 0 },
        tickets: { total: 0, open_count: 0 },
        devices: { total: 0, monitored: 0 },
      });
    });

    test('calls next on DB failure', async () => {
      db.queryReplica.mockRejectedValueOnce(new Error('timeout'));
      const res = mockRes();

      await dashboardController.summary(mockReq(), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'timeout' }));
    });
  });

  // -------------------------------------------------------------------------
  // revenue
  // -------------------------------------------------------------------------
  describe('revenue', () => {
    test('returns empty array when no invoices exist', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      const res = mockRes();

      await dashboardController.revenue(mockReq(), res, mockNext);

      expect(res.json).toHaveBeenCalledWith({ data: [] });
    });

    test('returns multiple months correctly', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { month: '2025-01', currency: 'MXN', invoiced: 1000, collected: 800, invoice_count: 5 },
        { month: '2024-12', currency: 'MXN', invoiced: 900, collected: 900, invoice_count: 4 },
      ]]);
      const res = mockRes();

      await dashboardController.revenue(mockReq(), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data).toHaveLength(2);
      expect(data[0].month).toBe('2025-01');
    });
  });

  // -------------------------------------------------------------------------
  // mrr
  // -------------------------------------------------------------------------
  describe('mrr', () => {
    test('returns empty array when no active contracts exist', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      const res = mockRes();

      await dashboardController.mrr(mockReq(), res, mockNext);

      expect(res.json).toHaveBeenCalledWith({ data: [] });
    });

    test('returns multiple currencies', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { currency: 'MXN', active_contracts: 10, mrr: 5000, arpu: 500 },
        { currency: 'USD', active_contracts: 2, mrr: 200, arpu: 100 },
      ]]);
      const res = mockRes();

      await dashboardController.mrr(mockReq(), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data).toHaveLength(2);
      expect(data[1].currency).toBe('USD');
    });
  });

  // -------------------------------------------------------------------------
  // deviceHealth
  // -------------------------------------------------------------------------
  describe('deviceHealth', () => {
    test('returns empty arrays when no devices or health data', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[]])   // devices by type
        .mockResolvedValueOnce([[]]);  // health snapshots

      const res = mockRes();
      await dashboardController.deviceHealth(mockReq(), res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        data: { devices_by_type: [], health_snapshots: [] },
      });
    });

    test('returns devices with no health snapshots', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ type: 'router', total: 5, monitored: 3, active: 4 }]])
        .mockResolvedValueOnce([[]]);

      const res = mockRes();
      await dashboardController.deviceHealth(mockReq(), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.devices_by_type).toHaveLength(1);
      expect(data.health_snapshots).toHaveLength(0);
    });

    test('calls next on DB error', async () => {
      db.queryReplica.mockRejectedValueOnce(new Error('snap fail'));
      const res = mockRes();

      await dashboardController.deviceHealth(mockReq(), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'snap fail' }));
    });
  });

  // -------------------------------------------------------------------------
  // overdue
  // -------------------------------------------------------------------------
  describe('overdue', () => {
    test('returns empty array when no overdue invoices', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      const res = mockRes();

      await dashboardController.overdue(mockReq(), res, mockNext);

      expect(res.json).toHaveBeenCalledWith({ data: [] });
    });

    test('returns overdue invoices sorted by days_overdue', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { id: 1, invoice_number: 'INV-1', total: 500, days_overdue: 30 },
        { id: 2, invoice_number: 'INV-2', total: 200, days_overdue: 10 },
      ]]);
      const res = mockRes();

      await dashboardController.overdue(mockReq(), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data).toHaveLength(2);
      expect(data[0].days_overdue).toBe(30);
    });

    test('calls next on DB error', async () => {
      db.queryReplica.mockRejectedValueOnce(new Error('overdue fail'));
      const res = mockRes();

      await dashboardController.overdue(mockReq(), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'overdue fail' }));
    });
  });
});

// ===========================================================================
// 3. exportController
// ===========================================================================
describe('exportController — deep', () => {
  // -------------------------------------------------------------------------
  // toCsv
  // -------------------------------------------------------------------------
  describe('toCsv', () => {
    test('returns empty string for empty array', () => {
      expect(exportController.toCsv([])).toBe('');
    });

    test('handles null and undefined values', () => {
      const csv = exportController.toCsv([{ a: null, b: undefined, c: 0 }]);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('a,b,c');
      expect(lines[1]).toBe(',,0');
    });

    test('escapes commas in values', () => {
      const csv = exportController.toCsv([{ name: 'Doe, John', age: 30 }]);
      expect(csv).toContain('"Doe, John"');
    });

    test('escapes double quotes inside values', () => {
      const csv = exportController.toCsv([{ note: 'He said "hello"' }]);
      expect(csv).toContain('"He said ""hello"""');
    });

    test('escapes newlines inside values', () => {
      const csv = exportController.toCsv([{ addr: 'line1\nline2' }]);
      expect(csv).toContain('"line1\nline2"');
    });

    test('handles single-row single-column', () => {
      const csv = exportController.toCsv([{ x: 42 }]);
      expect(csv).toBe('x\n42');
    });

    test('handles special characters that do not need quoting', () => {
      const csv = exportController.toCsv([{ v: 'abc-def_123' }]);
      expect(csv).toBe('v\nabc-def_123');
    });
  });

  // -------------------------------------------------------------------------
  // exportInvoices
  // -------------------------------------------------------------------------
  describe('exportInvoices', () => {
    test('sends empty CSV when no invoices exist', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const res = mockRes();

      await exportController.exportInvoices(mockReq(), res, mockNext);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.send).toHaveBeenCalledWith('');
    });

    test('calls next on DB error', async () => {
      db.query.mockRejectedValueOnce(new Error('query boom'));
      const res = mockRes();

      await exportController.exportInvoices(mockReq(), res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ message: 'query boom' }));
    });
  });

  // -------------------------------------------------------------------------
  // exportClients
  // -------------------------------------------------------------------------
  describe('exportClients', () => {
    test('CSV escapes commas and quotes in client data', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, first_name: 'O\'Brien, Jr', last_name: 'He said "hi"', email: 'a@b.com' },
      ]]);
      const res = mockRes();

      await exportController.exportClients(mockReq(), res, mockNext);

      const csvOutput = res.send.mock.calls[0][0];
      expect(csvOutput).toContain('"O\'Brien, Jr"');
      expect(csvOutput).toContain('"He said ""hi"""');
    });

    test('sends empty CSV for empty client list', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const res = mockRes();

      await exportController.exportClients(mockReq(), res, mockNext);

      expect(res.send).toHaveBeenCalledWith('');
    });
  });
});

// ===========================================================================
// 4. importController
// ===========================================================================
describe('importController — deep', () => {
  // -------------------------------------------------------------------------
  // parseCsv
  // -------------------------------------------------------------------------
  describe('parseCsv', () => {
    test('returns empty array for empty string', () => {
      expect(importController.parseCsv('')).toEqual([]);
    });

    test('returns empty array for CSV with only headers', () => {
      expect(importController.parseCsv('col_a,col_b,col_c')).toEqual([]);
    });

    test('parses quoted fields containing commas', () => {
      const csv = 'name,city\n"Doe, John","San José"';
      const rows = importController.parseCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Doe, John');
      expect(rows[0].city).toBe('San José');
    });

    test('handles escaped double quotes inside quoted fields', () => {
      const csv = 'note\n"He said ""hello"""\n"normal"';
      const rows = importController.parseCsv(csv);
      expect(rows[0].note).toBe('He said "hello"');
      expect(rows[1].note).toBe('normal');
    });

    test('trims header and value whitespace', () => {
      const csv = ' name , age \nAlice , 30 ';
      const rows = importController.parseCsv(csv);
      expect(rows[0]).toEqual({ name: 'Alice', age: '30' });
    });

    test('handles rows with fewer columns than headers', () => {
      const csv = 'a,b,c\n1';
      const rows = importController.parseCsv(csv);
      expect(rows[0]).toEqual({ a: '1', b: '', c: '' });
    });
  });

  // -------------------------------------------------------------------------
  // parseCsvLine
  // -------------------------------------------------------------------------
  describe('parseCsvLine', () => {
    test('parses simple comma-separated values', () => {
      expect(importController.parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    test('handles escaped quotes within quoted fields', () => {
      const result = importController.parseCsvLine('"He said ""hi""",normal');
      expect(result).toEqual(['He said "hi"', 'normal']);
    });

    test('handles empty fields', () => {
      expect(importController.parseCsvLine(',,')).toEqual(['', '', '']);
    });

    test('respects MAX_COLS limit of 200', () => {
      const line = Array(250).fill('v').join(',');
      const result = importController.parseCsvLine(line);
      expect(result.length).toBeLessThanOrEqual(200);
    });
  });

  // -------------------------------------------------------------------------
  // importClients
  // -------------------------------------------------------------------------
  describe('importClients', () => {
    test('returns 422 when csv field is missing', async () => {
      const res = mockRes();
      await importController.importClients(mockReq({}), res, mockNext);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }),
      );
    });

    test('reports error rows for missing required fields', async () => {
      const csv = 'first_name,last_name,email\n,Smith,a@b.com\nAlice,,b@c.com\n,\nBob,Jones,c@d.com';
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const res = mockRes();

      await importController.importClients(mockReq({ csv }), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.imported).toBe(1);
      expect(data.errors.length).toBeGreaterThanOrEqual(2);
      // Row 2 missing first_name, row 3 missing last_name, row 4 both missing
      data.errors.forEach(e => {
        expect(e.error).toContain('first_name and last_name are required');
      });
    });

    test('reports DB insert errors per row', async () => {
      const csv = 'first_name,last_name\nAlice,Smith\nBob,Jones';
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockRejectedValueOnce(new Error('duplicate email'));
      const res = mockRes();

      await importController.importClients(mockReq({ csv }), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.imported).toBe(1);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toEqual(expect.objectContaining({ row: 3, error: 'duplicate email' }));
    });

    test('returns zero imported for CSV with only headers', async () => {
      const csv = 'first_name,last_name,email';
      const res = mockRes();

      await importController.importClients(mockReq({ csv }), res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        data: { imported: 0, total: 0, errors: [] },
      });
    });
  });

  // -------------------------------------------------------------------------
  // importDevices
  // -------------------------------------------------------------------------
  describe('importDevices', () => {
    test('returns 422 when csv field is missing', async () => {
      const res = mockRes();
      await importController.importDevices(mockReq({}), res, mockNext);

      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('partial success: some rows succeed, some fail', async () => {
      const csv = 'name,ip_address,type\nRouter1,10.0.0.1,router\n,10.0.0.2,switch\nAP3,10.0.0.3,ap';
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([{ insertId: 2 }]);
      const res = mockRes();

      await importController.importDevices(mockReq({ csv }), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.imported).toBe(2);
      expect(data.total).toBe(3);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].row).toBe(3);
    });

    test('handles DB errors per device row', async () => {
      const csv = 'name,ip_address\nDev1,10.0.0.1\nDev2,10.0.0.2';
      db.query
        .mockRejectedValueOnce(new Error('dup IP'))
        .mockResolvedValueOnce([{ insertId: 2 }]);
      const res = mockRes();

      await importController.importDevices(mockReq({ csv }), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.imported).toBe(1);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toEqual(expect.objectContaining({ row: 2, error: 'dup IP' }));
    });

    test('returns zero imported for all-empty rows', async () => {
      const csv = 'name,ip_address\n,\n,';
      const res = mockRes();

      await importController.importDevices(mockReq({ csv }), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.imported).toBe(0);
      expect(data.errors).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // importContracts
  // -------------------------------------------------------------------------
  describe('importContracts', () => {
    test('returns 422 when csv field is missing', async () => {
      const res = mockRes();
      await importController.importContracts(mockReq({}), res, mockNext);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }),
      );
    });

    test('reports error for rows missing client_id or plan_id', async () => {
      const csv = 'client_id,plan_id,start_date\n,1,2025-01-01\n2,,2025-01-01\n3,4,2025-02-01';
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const res = mockRes();

      await importController.importContracts(mockReq({ csv }), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.imported).toBe(1);
      expect(data.errors).toHaveLength(2);
    });

    test('handles DB errors per contract row', async () => {
      const csv = 'client_id,plan_id\n1,2\n3,4';
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockRejectedValueOnce(new Error('FK constraint'));
      const res = mockRes();

      await importController.importContracts(mockReq({ csv }), res, mockNext);

      const data = res.json.mock.calls[0][0].data;
      expect(data.imported).toBe(1);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].error).toBe('FK constraint');
    });
  });
});
