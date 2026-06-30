// =============================================================================
// FireISP 5.0 — Dashboard Controller Tests
// =============================================================================
// Covers the revenue/financial accuracy fixes applied in fix/revenue-report-accuracy:
//   - void, cancelled, draft invoices excluded from invoiced/total_invoiced
//   - outstanding includes issued + sent + overdue (not just issued)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const { summary, revenue } = require('../src/controllers/dashboardController');

// Minimal Express-style request/response helpers
function makeReq(orgId = 1) {
  return { orgId };
}
function makeRes() {
  const res = {};
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('dashboardController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('summary()', () => {
    function seedSummaryMocks({ revenueRow } = {}) {
      const defaultRevenue = { outstanding: '500.00', collected: '4000.00', total_invoiced: '4500.00' };
      db.queryReplica
        .mockResolvedValueOnce([[{ total: 100, active: 80 }]])              // clients
        .mockResolvedValueOnce([[{ total: 90, active: 85, suspended: 5 }]]) // contracts
        .mockResolvedValueOnce([[revenueRow || defaultRevenue]])             // invoices
        .mockResolvedValueOnce([[{ total: 10, open_count: 3 }]])            // tickets
        .mockResolvedValueOnce([[{ total: 20, monitored: 15 }]]);           // devices
    }

    test('returns revenue_30d with outstanding, collected and total_invoiced', async () => {
      seedSummaryMocks();
      const req = makeReq();
      const res = makeRes();
      await summary(req, res, jest.fn());
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.revenue_30d).toMatchObject({
        outstanding: '500.00',
        collected: '4000.00',
        total_invoiced: '4500.00',
      });
    });

    test('invoice SQL excludes void, cancelled and draft from total_invoiced', async () => {
      // total_invoiced must not include voided or cancelled invoices.
      // Before fix: SUM(total) with no status filter — inflated by void/cancelled/draft.
      seedSummaryMocks();
      const req = makeReq();
      await summary(req, makeRes(), jest.fn());
      // The revenue query is the 3rd queryReplica call (index 2)
      const invoiceSql = db.queryReplica.mock.calls[2][0];
      expect(invoiceSql).toContain("NOT IN ('draft', 'void', 'cancelled')");
    });

    test('invoice SQL counts sent and overdue as outstanding (not just issued)', async () => {
      // Before fix: outstanding used CASE WHEN status = 'issued' — missing sent/overdue.
      // A sent invoice that hasn't been paid IS outstanding; an overdue one even more so.
      seedSummaryMocks();
      const req = makeReq();
      await summary(req, makeRes(), jest.fn());
      const invoiceSql = db.queryReplica.mock.calls[2][0];
      expect(invoiceSql).toContain("IN ('issued', 'sent', 'overdue')");
    });
  });

  describe('revenue()', () => {
    test('returns monthly rows with invoiced and collected', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { month: '2026-06', currency: 'MXN', invoiced: '10000.00', collected: '8000.00', invoice_count: 40 },
      ]]);
      const req = makeReq();
      const res = makeRes();
      await revenue(req, res, jest.fn());
      const payload = res.json.mock.calls[0][0];
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]).toMatchObject({ month: '2026-06', invoiced: '10000.00' });
    });

    test('invoiced column SQL excludes void, cancelled and draft', async () => {
      // Before fix: COALESCE(SUM(total), 0) AS invoiced — no status filter.
      // A voided invoice's amount was being added to the monthly "invoiced" bar.
      db.queryReplica.mockResolvedValueOnce([[]]);
      const req = makeReq();
      await revenue(req, makeRes(), jest.fn());
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("NOT IN ('draft', 'void', 'cancelled')");
    });

    test('invoice_count SQL excludes void, cancelled and draft', async () => {
      // The count column must reflect real invoices only, matching the invoiced total.
      db.queryReplica.mockResolvedValueOnce([[]]);
      const req = makeReq();
      await revenue(req, makeRes(), jest.fn());
      const [sql] = db.queryReplica.mock.calls[0];
      // Both the invoiced CASE and the invoice_count CASE use the same exclusion
      expect((sql.match(/NOT IN \('draft', 'void', 'cancelled'\)/g) || []).length).toBeGreaterThanOrEqual(2);
    });
  });
});
