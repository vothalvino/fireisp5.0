// =============================================================================
// FireISP 5.0 — Report Service Tests
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
const reportService = require('../src/services/reportService');

describe('reportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('agingReport()', () => {
    test('returns aging buckets and details', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { client_id: 1, first_name: 'John', last_name: 'Doe', email: 'john@test.com', invoice_id: 10, invoice_number: 'INV-001', total: '500.00', currency: 'MXN', due_date: '2026-01-15', days_overdue: 45, aging_bucket: '31-60' },
        { client_id: 2, first_name: 'Jane', last_name: 'Doe', email: 'jane@test.com', invoice_id: 11, invoice_number: 'INV-002', total: '300.00', currency: 'MXN', due_date: '2026-02-01', days_overdue: 10, aging_bucket: '1-30' },
      ]]);

      const result = await reportService.agingReport(1);
      expect(result.summary['31-60']).toBe(500);
      expect(result.summary['1-30']).toBe(300);
      expect(result.total_outstanding).toBe(800);
      expect(result.invoice_count).toBe(2);
      expect(result.details).toHaveLength(2);
    });

    test('filters by currency', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.agingReport(1, { currency: 'USD' });
      const [sql, params] = db.queryReplica.mock.calls[0];
      expect(sql).toContain('currency = ?');
      expect(params).toContain('USD');
    });

    test('includes issued, sent and overdue statuses (not just issued)', async () => {
      // AR aging must cover all unpaid statuses: issued, sent, overdue.
      // A void or cancelled invoice is NOT outstanding and must be excluded.
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.agingReport(1);
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("IN ('issued', 'sent', 'overdue')");
    });
  });

  describe('financialSummary()', () => {
    test('returns revenue, payments, and expenses', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ total_invoiced: '10000.00', total_collected: '8000.00', total_outstanding: '2000.00', invoice_count: 50 }]])
        .mockResolvedValueOnce([[{ total_payments: '8500.00', payment_count: 45 }]])
        .mockResolvedValueOnce([[{ total_expenses: '3000.00', expense_count: 20 }]]);

      const result = await reportService.financialSummary(1, { from: '2026-03-01', to: '2026-03-31' });
      expect(result.revenue.invoiced).toBe(10000);
      expect(result.revenue.collected).toBe(8000);
      expect(result.payments.total).toBe(8500);
      expect(result.expenses.total).toBe(3000);
      expect(result.net_income).toBe(5500);
    });

    test('total_invoiced query excludes void, cancelled and draft invoices', async () => {
      // void + cancelled invoices must not inflate the invoiced/billed metric.
      // draft invoices are not yet real invoices.
      db.queryReplica
        .mockResolvedValueOnce([[{ total_invoiced: '0', total_collected: '0', total_outstanding: '0', invoice_count: 0 }]])
        .mockResolvedValueOnce([[{ total_payments: '0', payment_count: 0 }]])
        .mockResolvedValueOnce([[{ total_expenses: '0', expense_count: 0 }]]);
      await reportService.financialSummary(1, { from: '2026-01-01', to: '2026-01-31' });
      // financialSummary fires 3 queries in parallel; the invoice query is the first call
      const [invoiceSql] = db.queryReplica.mock.calls[0];
      expect(invoiceSql).toContain("NOT IN ('draft', 'void', 'cancelled')");
    });

    test('total_outstanding covers issued, sent and overdue statuses', async () => {
      // "outstanding" = anything billed but not yet collected; sent and overdue
      // invoices are unpaid and must not be silently excluded from this metric.
      db.queryReplica
        .mockResolvedValueOnce([[{ total_invoiced: '0', total_collected: '0', total_outstanding: '0', invoice_count: 0 }]])
        .mockResolvedValueOnce([[{ total_payments: '0', payment_count: 0 }]])
        .mockResolvedValueOnce([[{ total_expenses: '0', expense_count: 0 }]]);
      await reportService.financialSummary(1, {});
      const [invoiceSql] = db.queryReplica.mock.calls[0];
      expect(invoiceSql).toContain("IN ('issued', 'sent', 'overdue')");
    });

    test('all three financial queries EXCLUDE soft-deleted records (deleted_at IS NULL)', async () => {
      // Regression: reportService had no deleted_at filter anywhere, so a
      // voided-by-soft-delete invoice/payment still inflated the report (the
      // demo showed 32 invoices / 36 payments when only 23 / 15 were live).
      db.queryReplica
        .mockResolvedValueOnce([[{ total_invoiced: '0', total_collected: '0', total_outstanding: '0', invoice_count: 0 }]])
        .mockResolvedValueOnce([[{ total_payments: '0', payment_count: 0 }]])
        .mockResolvedValueOnce([[{ total_expenses: '0', expense_count: 0 }]]);
      await reportService.financialSummary(1, {});
      const [invoiceSql] = db.queryReplica.mock.calls[0];
      const [paymentSql] = db.queryReplica.mock.calls[1];
      const [expenseSql] = db.queryReplica.mock.calls[2];
      expect(invoiceSql).toContain('deleted_at IS NULL');
      expect(paymentSql).toContain('deleted_at IS NULL');
      expect(expenseSql).toContain('deleted_at IS NULL');
    });
  });

  describe('technicianReport()', () => {
    test('returns technician productivity metrics', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { user_id: 1, first_name: 'Tech', last_name: 'A', total_jobs: 20, completed: 15, cancelled: 2, in_progress: 3, avg_completion_hours: 4.5 },
      ]]);

      const result = await reportService.technicianReport(1);
      expect(result.technicians).toHaveLength(1);
      expect(result.technicians[0].completed).toBe(15);
    });
  });

  describe('subscriberGrowthReport()', () => {
    test('returns monthly growth data', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { month: '2026-03', new_contracts: 10, churned: 2 },
        { month: '2026-02', new_contracts: 8, churned: 1 },
      ]]);

      const result = await reportService.subscriberGrowthReport(1, { months: 6 });
      expect(result.months).toHaveLength(2);
      expect(result.months[0].new_contracts).toBe(10);
    });
  });

  // =========================================================================
  // §15.1 Financial Report functions
  // =========================================================================

  describe('revenueByPeriod()', () => {
    test('returns monthly revenue rows', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { period: '2026-03', revenue: '5000.00', invoice_count: 20 },
      ]]);
      const result = await reportService.revenueByPeriod(1, { period: 'monthly' });
      expect(result).toHaveProperty('rows');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].period).toBe('2026-03');
    });

    test('uses daily grouping when period=daily', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.revenueByPeriod(1, { period: 'daily' });
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toMatch(/%Y-%m-%d/);
    });

    test('excludes void, cancelled and draft from total_invoiced and invoice_count', async () => {
      // The WHERE clause must filter out non-billable statuses so that voided
      // invoices do not inflate the "invoiced" column.
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.revenueByPeriod(1, { period: 'monthly' });
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("status NOT IN ('draft', 'void', 'cancelled')");
    });

    test('total_outstanding only covers unpaid active statuses (not draft)', async () => {
      // Before fix: outstanding used NOT IN ('paid','cancelled','void') which
      // incorrectly included draft invoices. After fix: IN ('issued','sent','overdue').
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.revenueByPeriod(1, {});
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("IN ('issued', 'sent', 'overdue')");
    });
  });

  describe('revenueByPlan()', () => {
    test('returns plan revenue breakdown', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { plan_name: 'Basic 10MB', revenue: '3000.00', subscriber_count: 12 },
      ]]);
      const result = await reportService.revenueByPlan(1, {});
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].plan_name).toBe('Basic 10MB');
    });

    test('excludes void, cancelled and draft invoices', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.revenueByPlan(1, {});
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("status NOT IN ('draft', 'void', 'cancelled')");
    });
  });

  describe('revenueByRegion()', () => {
    test('excludes void, cancelled and draft invoices', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.revenueByRegion(1, {});
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("status NOT IN ('draft', 'void', 'cancelled')");
    });
  });

  describe('revenueByAgent()', () => {
    test('excludes void, cancelled and draft invoices', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.revenueByAgent(1, {});
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("status NOT IN ('draft', 'void', 'cancelled')");
    });
  });

  describe('agentCommissions()', () => {
    test('excludes void, cancelled and draft from commission base', async () => {
      // Commissions must be calculated only on real billable invoices.
      // A voided invoice that was paid and then reversed must not earn a commission.
      db.queryReplica.mockResolvedValueOnce([[]]);
      await reportService.agentCommissions(1, {});
      const [sql] = db.queryReplica.mock.calls[0];
      expect(sql).toContain("status NOT IN ('draft', 'void', 'cancelled')");
    });
  });

  describe('cashFlowReport()', () => {
    test('returns rows with net cash flow per month', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ month: '2026-03', inflow: '1000.00' }]])
        .mockResolvedValueOnce([[{ month: '2026-03', outflow: '500.00' }]]);
      const result = await reportService.cashFlowReport(1, {});
      expect(result).toHaveProperty('rows');
      expect(result.rows[0]).toHaveProperty('net', 500);
    });
  });

  describe('taxSummary()', () => {
    test('returns total_tax and by_rate breakdown', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ total_tax: '1600.00', total_subtotal: '10000.00', total_invoiced: '11600.00' }]])
        .mockResolvedValueOnce([[{ tax_rate: '0.16', count: 5, total_tax: '1600.00', total_subtotal: '10000.00' }]]);
      const result = await reportService.taxSummary(1, {});
      expect(result).toHaveProperty('total_tax', 1600);
      expect(result.by_rate).toHaveLength(1);
    });

    test('excludes void, cancelled and draft from both summary and by-rate queries', async () => {
      // Tax on a voided invoice must not appear in the SAT liability total.
      db.queryReplica
        .mockResolvedValueOnce([[{ total_tax: '0', total_subtotal: '0', total_invoiced: '0' }]])
        .mockResolvedValueOnce([[]]);
      await reportService.taxSummary(1, {});
      const calls = db.queryReplica.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toContain("status NOT IN ('draft', 'void', 'cancelled')");
      expect(calls[1][0]).toContain("status NOT IN ('draft', 'void', 'cancelled')");
    });
  });

  // =========================================================================
  // §15.2 Operational Report functions
  // =========================================================================

  describe('subscriberCounts()', () => {
    test('returns subscriber count per month', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { month: '2026-03', active_count: 100, suspended_count: 5, cancelled_count: 3 },
      ]]);
      const result = await reportService.subscriberCounts(1, {});
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('arpuReport()', () => {
    test('returns ARPU per month', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { month: '2026-03', arpu: '250.50', subscribers: 40 },
      ]]);
      const result = await reportService.arpuReport(1, { months: 3 });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].month).toBe('2026-03');
    });
  });

  describe('mttrReport()', () => {
    test('returns avg_mttr_hours and monthly rows', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ avg_mttr_hours: 4.5, total_resolved: 20 }]])
        .mockResolvedValueOnce([[{ month: '2026-03', count: 10, avg_hours: 4.5 }]]);
      const result = await reportService.mttrReport(1, {});
      expect(result).toHaveProperty('avg_mttr_hours', 4.5);
      expect(result.rows).toHaveLength(1);
    });
  });

  // =========================================================================
  // §15.3 Network Report functions
  // =========================================================================

  describe('deviceReboots()', () => {
    test('returns device reboot counts', async () => {
      db.queryReplica.mockResolvedValueOnce([[
        { device_id: 1, hostname: 'router-01', reboot_count: 3 },
      ]]);
      const result = await reportService.deviceReboots(1, {});
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('capacityForecast()', () => {
    test('returns forecast with regression', async () => {
      const months = Array.from({ length: 6 }, (_, i) => ({
        month: `2026-0${i + 1}`, active_subscribers: 100 + i * 5,
      }));
      db.queryReplica.mockResolvedValueOnce([months]);
      const result = await reportService.capacityForecast(1, { forecast_months: 3 });
      expect(result).toHaveProperty('historical');
      expect(result).toHaveProperty('forecast');
      expect(result.forecast.length).toBeGreaterThan(0);
    });

    test('returns empty forecast when no historical data', async () => {
      db.queryReplica.mockResolvedValueOnce([[]]);
      const result = await reportService.capacityForecast(1, {});
      expect(result.historical).toHaveLength(0);
      expect(result.forecast).toHaveLength(0);
    });
  });

  // =========================================================================
  // §15.4 Compliance Report functions
  // =========================================================================

  describe('dataRetentionCompliance()', () => {
    test('returns rows for 4 tables', async () => {
      // dataRetentionCompliance queries 4 tables in parallel via Promise.all
      db.queryReplica
        .mockResolvedValueOnce([[{ old_record_count: 0 }]])   // invoices
        .mockResolvedValueOnce([[{ old_record_count: 0 }]])   // payments
        .mockResolvedValueOnce([[{ old_record_count: 0 }]])   // clients
        .mockResolvedValueOnce([[{ old_record_count: 0 }]]);  // contracts
      const result = await reportService.dataRetentionCompliance(1);
      expect(result).toHaveProperty('rows');
      expect(result.rows).toHaveLength(4);
      expect(result.rows[0]).toHaveProperty('table_name', 'invoices');
    });
  });

  describe('interceptionReadiness()', () => {
    test('returns has_nas, active_contracts, and ready flag', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ cnt: 1 }]])   // NAS devices
        .mockResolvedValueOnce([[{ cnt: 50 }]])  // active contracts
        .mockResolvedValueOnce([[{ cnt: 40 }]]); // active ip_assignments
      const result = await reportService.interceptionReadiness(1);
      expect(result).toHaveProperty('has_nas', true);
      expect(result).toHaveProperty('active_contracts', 50);
      expect(result).toHaveProperty('ready', true);
    });

    test('ready is false when no NAS', async () => {
      db.queryReplica
        .mockResolvedValueOnce([[{ cnt: 0 }]])   // no NAS
        .mockResolvedValueOnce([[{ cnt: 50 }]])
        .mockResolvedValueOnce([[{ cnt: 40 }]]);
      const result = await reportService.interceptionReadiness(1);
      expect(result.ready).toBe(false);
    });
  });
});
