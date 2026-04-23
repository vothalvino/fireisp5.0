// =============================================================================
// FireISP 5.0 — Domain Controller Tests
// =============================================================================
// Tests for billingController, cfdiController, suspensionController,
// dashboardController, exportController, and importController.
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

jest.mock('../src/services/cfdiService', () => ({
  generateXml: jest.fn(),
  stamp: jest.fn(),
  cancel: jest.fn(),
}));

jest.mock('../src/services/suspensionService', () => ({
  evaluateRules: jest.fn(),
  suspendContract: jest.fn(),
  reconnectContract: jest.fn(),
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const cfdiService = require('../src/services/cfdiService');
const suspensionService = require('../src/services/suspensionService');

const billingController = require('../src/controllers/billingController');
const cfdiController = require('../src/controllers/cfdiController');
const suspensionController = require('../src/controllers/suspensionController');
const dashboardController = require('../src/controllers/dashboardController');
const exportController = require('../src/controllers/exportController');
const importController = require('../src/controllers/importController');

// Mock Express req/res/next
function mockReq(overrides = {}) {
  return {
    orgId: 42,
    user: { id: 1 },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('Domain Controllers', () => {
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

  // =========================================================================
  // billingController
  // =========================================================================
  describe('billingController', () => {
    test('generatePeriod creates period for valid contract', async () => {
      const req = mockReq({ body: { contract_id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, organization_id: 42 }]]);  // contract
      billingService.generateBillingPeriod.mockResolvedValueOnce({ id: 10, status: 'pending' });

      await billingController.generatePeriod(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: { id: 10, status: 'pending' } });
    });

    test('generatePeriod returns 404 for unknown contract', async () => {
      const req = mockReq({ body: { contract_id: 999 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[]]);

      await billingController.generatePeriod(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('generateInvoice creates period and invoice', async () => {
      const req = mockReq({ body: { contract_id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query
        .mockResolvedValueOnce([[{ id: 1, plan_id: 5, organization_id: 42 }]])  // contract
        .mockResolvedValueOnce([[{ id: 5, name: 'Basic', price: 500 }]]);  // plan
      billingService.generateBillingPeriod.mockResolvedValueOnce({ id: 10, status: 'pending' });
      billingService.generateInvoice.mockResolvedValueOnce({ id: 50, total: 580 });

      await billingController.generateInvoice(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: { id: 50, total: 580 } });
    });

    test('bulkGenerate processes all active contracts', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[
        { id: 1, plan_name: 'A', plan_price: 100, plan_currency: 'MXN', organization_id: 42 },
        { id: 2, plan_name: 'B', plan_price: 200, plan_currency: 'MXN', organization_id: 42 },
      ]]);
      billingService.generateBillingPeriod
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' });
      billingService.generateInvoice
        .mockResolvedValueOnce({ id: 50 })
        .mockResolvedValueOnce({ id: 51 });

      await billingController.bulkGenerate(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ generated: 2, total_contracts: 2 }),
      }));
    });
  });

  // =========================================================================
  // cfdiController
  // =========================================================================
  describe('cfdiController', () => {
    test('generateXml generates XML for valid document', async () => {
      const req = mockReq({ body: { cfdi_document_id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, organization_id: 42 }]]);
      cfdiService.generateXml.mockResolvedValueOnce({ cfdi_document_id: 1, xml: '<cfdi/>' });

      await cfdiController.generateXml(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ data: { cfdi_document_id: 1, xml: '<cfdi/>' } });
    });

    test('stamp stamps document via PAC', async () => {
      const req = mockReq({ body: { cfdi_document_id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, organization_id: 42 }]]);
      cfdiService.stamp.mockResolvedValueOnce({ cfdi_document_id: 1, uuid: 'abc-123', status: 'vigente' });

      await cfdiController.stamp(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: { cfdi_document_id: 1, uuid: 'abc-123', status: 'vigente' },
      });
    });

    test('cancel cancels stamped document', async () => {
      const req = mockReq({ body: { cfdi_document_id: 1, reason: '02', replacement_uuid: null } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, organization_id: 42 }]]);
      cfdiService.cancel.mockResolvedValueOnce({ cfdi_document_id: 1, status: 'cancel_pending' });

      await cfdiController.cancel(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: { cfdi_document_id: 1, status: 'cancel_pending' },
      });
    });

    test('downloadXml returns 404 when no XML content', async () => {
      const req = mockReq({ params: { id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, xml_content: null, organization_id: 42 }]]);

      await cfdiController.downloadXml(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('downloadXml sends XML content', async () => {
      const req = mockReq({ params: { id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{
        id: 1, xml_content: '<cfdi/>', uuid: 'abc', organization_id: 42,
      }]]);

      await cfdiController.downloadXml(req, res, next);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/xml');
      expect(res.send).toHaveBeenCalledWith('<cfdi/>');
    });
  });

  // =========================================================================
  // suspensionController
  // =========================================================================
  describe('suspensionController', () => {
    test('evaluate returns actionable contracts', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      suspensionService.evaluateRules.mockResolvedValueOnce([
        { rule: { id: 1, action: 'auto_suspend' }, contract: { id: 10, client_id: 5, invoice_id: 50, days_overdue: 20 } },
      ]);

      await suspensionController.evaluate(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ contract_id: 10, days_overdue: 20 })],
      });
    });

    test('suspend returns 422 if already suspended', async () => {
      const req = mockReq({ body: { contract_id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, status: 'suspended', organization_id: 42 }]]);

      await suspensionController.suspend(req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('suspend succeeds for active contract', async () => {
      const req = mockReq({ body: { contract_id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, status: 'active', organization_id: 42 }]]);
      suspensionService.suspendContract.mockResolvedValueOnce();

      await suspensionController.suspend(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ data: { contract_id: 1, status: 'suspended' } });
    });

    test('reconnect returns 422 if not suspended', async () => {
      const req = mockReq({ body: { contract_id: 1 } });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[{ id: 1, status: 'active', organization_id: 42 }]]);

      await suspensionController.reconnect(req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
    });
  });

  // =========================================================================
  // dashboardController
  // =========================================================================
  describe('dashboardController', () => {
    test('summary returns aggregated KPIs', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      db.queryReplica
        .mockResolvedValueOnce([[{ total: 100, active: 90 }]])       // clients
        .mockResolvedValueOnce([[{ total: 80, active: 70, suspended: 5 }]])  // contracts
        .mockResolvedValueOnce([[{ outstanding: 5000, collected: 15000, total_invoiced: 20000 }]])  // revenue
        .mockResolvedValueOnce([[{ total: 50, open_count: 10 }]])    // tickets
        .mockResolvedValueOnce([[{ total: 30, monitored: 25 }]]);    // devices

      await dashboardController.summary(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clients: expect.objectContaining({ total: 100 }),
          contracts: expect.objectContaining({ active: 70 }),
        }),
      });
    });

    test('mrr returns MRR and ARPU', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      db.queryReplica.mockResolvedValueOnce([[{ currency: 'MXN', active_contracts: 50, mrr: 25000, arpu: 500 }]]);

      await dashboardController.mrr(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ mrr: 25000 })],
      });
    });
  });

  // =========================================================================
  // exportController
  // =========================================================================
  describe('exportController', () => {
    test('toCsv converts array of objects to CSV string', () => {
      const rows = [
        { name: 'Alice', age: 30 },
        { name: 'Bob, Jr', age: 25 },
      ];
      const csv = exportController.toCsv(rows);
      expect(csv).toContain('name,age');
      expect(csv).toContain('"Bob, Jr"');
    });

    test('toCsv returns empty string for empty array', () => {
      expect(exportController.toCsv([])).toBe('');
    });

    test('exportInvoices sends CSV', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([[
        { id: 1, invoice_number: 'INV-001', total: 500, status: 'paid' },
      ]]);

      await exportController.exportInvoices(req, res, next);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.send).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // importController
  // =========================================================================
  describe('importController', () => {
    test('parseCsv parses simple CSV correctly', () => {
      const csv = 'first_name,last_name,email\nAlice,Smith,alice@test.com\nBob,Jones,bob@test.com';
      const rows = importController.parseCsv(csv);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ first_name: 'Alice', last_name: 'Smith', email: 'alice@test.com' });
    });

    test('parseCsv handles quoted fields', () => {
      const csv = 'name,city\n"O\'Brien, Jr","New York"\nSmith,LA';
      const rows = importController.parseCsv(csv);

      expect(rows[0].name).toBe("O'Brien, Jr");
      expect(rows[0].city).toBe('New York');
    });

    test('parseCsv returns empty for single-line input', () => {
      expect(importController.parseCsv('header_only')).toEqual([]);
    });

    test('importClients returns 422 if no csv field', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();
      const next = jest.fn();

      await importController.importClients(req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
    });

    test('importClients imports valid rows', async () => {
      const req = mockReq({
        body: { csv: 'first_name,last_name,email\nAlice,Smith,alice@test.com\nBob,Jones,bob@test.com' },
      });
      const res = mockRes();
      const next = jest.fn();

      db.query
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([{ insertId: 2 }]);

      await importController.importClients(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({ imported: 2, total: 2 }),
      });
    });

    test('importClients reports errors for invalid rows', async () => {
      const req = mockReq({
        body: { csv: 'first_name,last_name\n,\nAlice,Smith' },
      });
      const res = mockRes();
      const next = jest.fn();

      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      await importController.importClients(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({ imported: 1, errors: expect.arrayContaining([expect.objectContaining({ row: 2 })]) }),
      });
    });
  });
});
