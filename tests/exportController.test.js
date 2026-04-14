// =============================================================================
// FireISP 5.0 — Export Controller Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const db = require('../src/config/database');
const {
  toCsv,
  exportInvoices,
  exportClients,
  exportContracts,
  exportPayments,
} = require('../src/controllers/exportController');

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

describe('exportController', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // toCsv
  // ---------------------------------------------------------------------------
  describe('toCsv', () => {
    test('returns empty string for empty array', () => {
      expect(toCsv([])).toBe('');
    });

    test('creates header row and data rows', () => {
      const rows = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      const csv = toCsv(rows);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('id,name');
      expect(lines[1]).toBe('1,Alice');
      expect(lines[2]).toBe('2,Bob');
    });

    test('escapes commas in values', () => {
      const csv = toCsv([{ note: 'a,b' }]);
      expect(csv).toContain('"a,b"');
    });

    test('escapes double quotes in values', () => {
      const csv = toCsv([{ note: 'say "hello"' }]);
      expect(csv).toContain('"say ""hello"""');
    });

    test('escapes newlines in values', () => {
      const csv = toCsv([{ note: 'line1\nline2' }]);
      expect(csv).toContain('"line1\nline2"');
    });

    test('handles null and undefined values', () => {
      const csv = toCsv([{ a: null, b: undefined, c: 'ok' }]);
      const dataLine = csv.split('\n')[1];
      expect(dataLine).toBe(',,ok');
    });
  });

  // ---------------------------------------------------------------------------
  // exportInvoices
  // ---------------------------------------------------------------------------
  describe('exportInvoices', () => {
    test('calls db.query with orgId', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }]]);
      const { req, res, next } = mockReqRes({ orgId: 7 });
      await exportInvoices(req, res, next);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), [7]);
    });

    test('SQL contains organization_id filter', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const { req, res, next } = mockReqRes();
      await exportInvoices(req, res, next);
      expect(db.query.mock.calls[0][0]).toContain('organization_id');
    });

    test('sets CSV content-type and disposition headers', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }]]);
      const { req, res, next } = mockReqRes();
      await exportInvoices(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="invoices.csv"');
    });

    test('calls next(err) on db error', async () => {
      const error = new Error('db fail');
      db.query.mockRejectedValueOnce(error);
      const { req, res, next } = mockReqRes();
      await exportInvoices(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ---------------------------------------------------------------------------
  // exportClients
  // ---------------------------------------------------------------------------
  describe('exportClients', () => {
    test('sets CSV headers and sends data', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, first_name: 'Jane' }]]);
      const { req, res, next } = mockReqRes();
      await exportClients(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="clients.csv"');
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('first_name'));
    });

    test('calls next(err) on db error', async () => {
      const error = new Error('db fail');
      db.query.mockRejectedValueOnce(error);
      const { req, res, next } = mockReqRes();
      await exportClients(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ---------------------------------------------------------------------------
  // exportContracts
  // ---------------------------------------------------------------------------
  describe('exportContracts', () => {
    test('sets CSV headers and sends data', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, client_id: 2 }]]);
      const { req, res, next } = mockReqRes();
      await exportContracts(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="contracts.csv"');
    });

    test('calls next(err) on db error', async () => {
      const error = new Error('db fail');
      db.query.mockRejectedValueOnce(error);
      const { req, res, next } = mockReqRes();
      await exportContracts(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ---------------------------------------------------------------------------
  // exportPayments
  // ---------------------------------------------------------------------------
  describe('exportPayments', () => {
    test('sets CSV headers and sends data', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, amount: 50 }]]);
      const { req, res, next } = mockReqRes();
      await exportPayments(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="payments.csv"');
    });

    test('calls next(err) on db error', async () => {
      const error = new Error('db fail');
      db.query.mockRejectedValueOnce(error);
      const { req, res, next } = mockReqRes();
      await exportPayments(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
