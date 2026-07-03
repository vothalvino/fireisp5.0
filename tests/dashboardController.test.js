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
const { summary, revenue, throughput, liveSessions, sitesUtilization, networkDevices } = require('../src/controllers/dashboardController');

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

  describe('throughput()', () => {
    test('returns an empty series (has_data=false) when there is no SNMP telemetry', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      const res = makeRes();
      await throughput({ orgId: 1, query: { range: '24H' } }, res, jest.fn());
      const { data } = res.json.mock.calls[0][0];
      expect(data.has_data).toBe(false);
      expect(data.range).toBe('24H');
      expect(data.points).toHaveLength(96);
      expect(data.peak_gbps).toBe(0);
    });

    test('aggregates interface counter deltas into a real bit-rate', async () => {
      const now = Date.now();
      // BIGINT columns arrive as strings from mysql2 — exercise Number() coercion.
      db.queryReplica.mockResolvedValueOnce([[
        { iface: '1:1', t: now - 2000, inO: '0', outO: '0' },
        { iface: '1:1', t: now - 1000, inO: '1000000', outO: '0' },
      ]]);
      const res = makeRes();
      await throughput({ orgId: 1, query: { range: '24H' } }, res, jest.fn());
      const { data } = res.json.mock.calls[0][0];
      expect(data.has_data).toBe(true);
      // 1,000,000 bytes over 1s = 8,000,000 bps in the most recent bucket.
      expect(Math.max(...data.points.map((p) => p.in_bps))).toBe(8_000_000);
    });

    test('defaults an unknown range to 24H and org-scopes / interface-filters the query', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      const res = makeRes();
      await throughput({ orgId: 7, query: { range: 'bogus' } }, res, jest.fn());
      expect(res.json.mock.calls[0][0].data.range).toBe('24H');
      const [sql, params] = db.queryReplica.mock.calls[0];
      expect(sql).toContain('d.organization_id = ?');
      expect(sql).toContain('m.interface_id IS NOT NULL');
      expect(params[0]).toBe(7);
    });

    test('honours a valid range param (1H → 60 buckets)', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      const res = makeRes();
      await throughput({ orgId: 1, query: { range: '1H' } }, res, jest.fn());
      const { data } = res.json.mock.calls[0][0];
      expect(data.range).toBe('1H');
      expect(data.points).toHaveLength(60);
    });
  });

  describe('liveSessions()', () => {
    test('formats the count and % of base, org-scoped', async () => {
      db.queryReplica.mockResolvedValueOnce([[{ live_sessions: 1284, subscriber_base: 1370 }]]);
      const res = makeRes();
      await liveSessions({ orgId: 3 }, res, jest.fn());
      const { data } = res.json.mock.calls[0][0];
      expect(data.value).toBe('1,284');
      expect(data.note).toBe('RADIUS · 94% of base'); // 1284/1370 → 94%
      const [sql, params] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("event_type = 'start'");
      expect(sql).toContain('organization_id = ?');
      // Hardened: only count sessions with a real session_id (NULL never matches a
      // stop → would count as live forever), and fall back to NAS on a join miss.
      expect(sql).toContain('cl.session_id IS NOT NULL');
      expect(sql).toContain('c.id IS NULL');
      expect(params).toEqual([3, 3, 3]);
    });

    test('guards divide-by-zero when there are no active contracts', async () => {
      db.queryReplica.mockResolvedValueOnce([[{ live_sessions: 0, subscriber_base: 0 }]]);
      const res = makeRes();
      await liveSessions({ orgId: 1 }, res, jest.fn());
      const { data } = res.json.mock.calls[0][0];
      expect(data.value).toBe('0');
      expect(data.note).toBe('RADIUS · no active contracts');
    });
  });

  describe('sitesUtilization()', () => {
    test('maps site device-health counts to numbers', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { id: 1, name: 'Norte', city: 'CDMX', site_type: 'pop', device_count: '5', devices_online: '4' },
      ]]);
      const res = makeRes();
      await sitesUtilization({ orgId: 1 }, res, jest.fn());
      const { data } = res.json.mock.calls[0][0];
      expect(data[0]).toMatchObject({ id: 1, name: 'Norte', device_count: 5, devices_online: 4 });
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain('FROM sites s');
      expect(sql).toContain("d.status = 'online'");
    });
  });

  describe('networkDevices()', () => {
    test('maps device rows, coercing cpu null and clients number', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { id: 1, name: 'bras-01', status: 'online', ip_address: '10.0.0.1', type: 'router', manufacturer: 'MikroTik', model: 'CCR', role: 'core', last_poll_error: null, cpu: '28', clients: '8420' },
        { id: 2, name: 'ptmp-2', status: 'offline', ip_address: '10.0.6.4', type: 'ptmp_ap', manufacturer: null, model: null, role: 'access', last_poll_error: null, cpu: null, clients: '0' },
      ]]);
      const res = makeRes();
      await networkDevices({ orgId: 1 }, res, jest.fn());
      const { data } = res.json.mock.calls[0][0];
      expect(data[0]).toMatchObject({ name: 'bras-01', status: 'online', cpu: 28, clients: 8420 });
      expect(data[1].cpu).toBeNull();
      expect(data[1].clients).toBe(0);
      const [sql, params] = db.queryReplica.mock.calls[0];
      expect(sql).toContain('FROM devices d');
      expect(sql).toContain('d.organization_id = ?');
      // Latest CPU via a correlated scalar subquery → exactly one row per device
      // (a MAX(polled_at) join could tie and duplicate the device row).
      expect(sql).toContain('ORDER BY sm.polled_at DESC');
      expect(sql).toContain('LIMIT 1');
      expect(sql).toContain('cl.session_id IS NOT NULL');
      expect(params).toEqual([1]);
    });
  });
});
