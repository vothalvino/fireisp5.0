// =============================================================================
// FireISP 5.0 — Data Usage Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const usageService = require('../src/services/usageService');

describe('usageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getClientUsage()', () => {
    test('returns aggregated usage for a client', async () => {
      db.query.mockResolvedValueOnce([[{
        session_count: 5,
        total_bytes_in: 1073741824, // 1 GB
        total_bytes_out: 536870912,  // 0.5 GB
        total_bytes: 1610612736,
        total_duration_seconds: 3600,
        period_start: '2026-03-01',
        period_end: '2026-03-31',
      }]]);

      const result = await usageService.getClientUsage(1);
      expect(result.client_id).toBe(1);
      expect(result.download_gb).toBe(1);
      expect(result.upload_gb).toBe(0.5);
      expect(result.total_gb).toBe(1.5);
      expect(result.sessions).toBe(5);
    });

    test('applies date filters', async () => {
      db.query.mockResolvedValueOnce([[{
        session_count: 0,
        total_bytes_in: 0,
        total_bytes_out: 0,
        total_bytes: 0,
        total_duration_seconds: 0,
        period_start: null,
        period_end: null,
      }]]);

      await usageService.getClientUsage(1, { from: '2026-03-01', to: '2026-03-31' });
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('event_at >= ?');
      expect(sql).toContain('event_at <= ?');
      expect(params).toContain('2026-03-01');
      expect(params).toContain('2026-03-31');
    });
  });

  describe('getDailyUsage()', () => {
    test('returns daily breakdown', async () => {
      db.query.mockResolvedValueOnce([[
        { date: '2026-03-15', bytes_in: 1073741824, bytes_out: 536870912, bytes_total: 1610612736, sessions: 3, duration_seconds: 1800 },
        { date: '2026-03-14', bytes_in: 2147483648, bytes_out: 1073741824, bytes_total: 3221225472, sessions: 5, duration_seconds: 3600 },
      ]]);

      const result = await usageService.getDailyUsage(1);
      expect(result).toHaveLength(2);
      expect(result[0].download_gb).toBe(1);
      expect(result[1].download_gb).toBe(2);
    });
  });

  describe('getTopUsers()', () => {
    test('returns top bandwidth users', async () => {
      db.query.mockResolvedValueOnce([[
        { contract_id: 1, client_id: 10, bytes_in: 10737418240, bytes_out: 5368709120, bytes_total: 16106127360 },
        { contract_id: 2, client_id: 20, bytes_in: 5368709120, bytes_out: 2684354560, bytes_total: 8053063680 },
      ]]);

      const result = await usageService.getTopUsers(1);
      expect(result).toHaveLength(2);
      expect(result[0].total_gb).toBe(15);
    });

    test('respects limit parameter', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await usageService.getTopUsers(1, { limit: 5 });
      const params = db.query.mock.calls[0][1];
      expect(params).toContain(5);
    });
  });

  describe('checkDataCaps()', () => {
    test('returns contracts over their data cap', async () => {
      db.query.mockResolvedValueOnce([[{
        contract_id: 1,
        client_id: 10,
        data_cap_gb: 100,
        bytes_used: 161061273600, // 150 GB
      }]]);

      const result = await usageService.checkDataCaps(1);
      expect(result).toHaveLength(1);
      expect(result[0].cap_gb).toBe(100);
      expect(result[0].used_gb).toBe(150);
      expect(result[0].usage_pct).toBe(150);
    });
  });
});
