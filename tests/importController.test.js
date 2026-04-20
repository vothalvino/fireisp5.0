// =============================================================================
// FireISP 5.0 — Import Controller Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const db = require('../src/config/database');
const {
  parseCsv,
  parseCsvLine,
  parseXlsx,
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
 * Build a minimal valid XLSX buffer using ExcelJS.
 * Used to test file-upload paths without hitting the filesystem.
 */
async function buildXlsxBuffer(headers, dataRows) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Sheet1');
  ws.addRow(headers);
  for (const row of dataRows) {
    ws.addRow(row);
  }
  return workbook.xlsx.writeBuffer();
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
      const csv = 'first_name,last_name,email\nAlice,Smith,a@b.com\nBob,Jones,b@c.com';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importClients(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        data: { imported: 2, total: 2, errors: [] },
      });
    });

    test('tracks errors for rows missing required fields', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'first_name,last_name\n,Smith\nBob,Jones';
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
      const csv = 'first_name,last_name\nAlice,Smith\nBob,Jones';
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

    test('imports valid rows', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,plan_id,start_date\n1,2,2024-01-01';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importContracts(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        data: { imported: 1, total: 1, errors: [] },
      });
    });

    test('validates required fields client_id and plan_id', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,plan_id\n,2\n1,';
      const { req, res, next } = mockReqRes({ body: { csv } });
      await importContracts(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // parseXlsx
  // ---------------------------------------------------------------------------
  describe('parseXlsx', () => {
    test('parses an xlsx buffer into row objects', async () => {
      const buf = await buildXlsxBuffer(
        ['first_name', 'last_name', 'email'],
        [['Alice', 'Smith', 'a@b.com'], ['Bob', 'Jones', 'b@c.com']],
      );
      const rows = await parseXlsx(buf);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ first_name: 'Alice', last_name: 'Smith', email: 'a@b.com' });
      expect(rows[1]).toEqual({ first_name: 'Bob', last_name: 'Jones', email: 'b@c.com' });
    });

    test('returns empty array for empty workbook', async () => {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Empty');
      const buf = await workbook.xlsx.writeBuffer();
      const rows = await parseXlsx(buf);
      expect(rows).toEqual([]);
    });

    test('respects 10000 row limit', async () => {
      const dataRows = Array.from({ length: 10050 }, (_, i) => [`c${i}`, `l${i}`, `e${i}@x.com`]);
      const buf = await buildXlsxBuffer(['first_name', 'last_name', 'email'], dataRows);
      const rows = await parseXlsx(buf);
      expect(rows.length).toBe(10000);
    });
  });

  // ---------------------------------------------------------------------------
  // parseUploadedFile
  // ---------------------------------------------------------------------------
  describe('parseUploadedFile', () => {
    test('delegates to parseCsv for .csv extension', async () => {
      const csv = 'a,b\n1,2';
      const rows = await parseUploadedFile(Buffer.from(csv), 'data.csv');
      expect(rows).toEqual([{ a: '1', b: '2' }]);
    });

    test('delegates to parseXlsx for .xlsx extension', async () => {
      const buf = await buildXlsxBuffer(['x', 'y'], [['10', '20']]);
      const rows = await parseUploadedFile(buf, 'data.xlsx');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ x: '10', y: '20' });
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
      const csv = 'first_name,last_name,email\nAlice,Smith,a@b.com';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'clients.csv' },
      });
      await importClientsFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('imports clients from an XLSX buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['first_name', 'last_name', 'email'],
        [['Alice', 'Smith', 'a@b.com'], ['Bob', 'Jones', 'b@c.com']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'clients.xlsx' },
      });
      await importClientsFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 2, total: 2, errors: [] } });
    });

    test('tracks validation errors for rows missing required fields', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['first_name', 'last_name'],
        [['', 'Smith'], ['Bob', 'Jones']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'clients.xlsx' },
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

    test('imports devices from an XLSX file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['name', 'ip_address', 'type'],
        [['Router1', '10.0.0.1', 'router']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'devices.xlsx' },
      });
      await importDevicesFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('validates required fields name and ip_address', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['name', 'ip_address'],
        [['', '10.0.0.1'], ['Router2', '']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'devices.xlsx' },
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

    test('imports contracts from a CSV file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const csv = 'client_id,plan_id,start_date\n1,2,2024-01-01';
      const { req, res, next } = mockReqRes({
        file: { buffer: Buffer.from(csv), originalname: 'contracts.csv' },
      });
      await importContractsFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('imports contracts from an XLSX file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['client_id', 'plan_id', 'start_date'],
        [['1', '2', '2024-01-01']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'contracts.xlsx' },
      });
      await importContractsFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 1, total: 1, errors: [] } });
    });

    test('validates required fields client_id and plan_id', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['client_id', 'plan_id'],
        [['', '2'], ['1', '']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'contracts.xlsx' },
      });
      await importContractsFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
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

    test('imports invoices from an XLSX file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['client_id', 'invoice_number', 'issue_date', 'due_date'],
        [['1', 'INV-008', '2024-01-01', '2024-01-31'], ['2', 'INV-009', '2024-02-01', '2024-02-28']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'invoices.xlsx' },
      });
      await importInvoicesFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 2, total: 2, errors: [] } });
    });

    test('validates required fields in file upload', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['client_id', 'invoice_number', 'issue_date', 'due_date'],
        [['', 'INV-010', '2024-01-01', '2024-01-31']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'invoices.xlsx' },
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

    test('imports payments from an XLSX file buffer', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['client_id', 'amount', 'payment_date', 'payment_method'],
        [['1', '250.00', '2024-01-20', 'spei'], ['2', '300.00', '2024-01-21', 'cash']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'payments.xlsx' },
      });
      await importPaymentsFile(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ data: { imported: 2, total: 2, errors: [] } });
    });

    test('validates required fields in file upload', async () => {
      db.query.mockResolvedValue([{ insertId: 1 }]);
      const buf = await buildXlsxBuffer(
        ['client_id', 'amount', 'payment_date'],
        [['1', '', '2024-01-20']],
      );
      const { req, res, next } = mockReqRes({
        file: { buffer: buf, originalname: 'payments.xlsx' },
      });
      await importPaymentsFile(req, res, next);
      const result = res.json.mock.calls[0][0].data;
      expect(result.imported).toBe(0);
      expect(result.errors[0].error).toMatch(/amount is required/);
    });
  });
});
