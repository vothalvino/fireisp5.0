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
});
