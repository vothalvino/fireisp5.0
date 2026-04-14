// =============================================================================
// FireISP 5.0 — Import Controller Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const db = require('../src/config/database');
const {
  parseCsv,
  parseCsvLine,
  importClients,
  importDevices,
  importContracts,
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
});
