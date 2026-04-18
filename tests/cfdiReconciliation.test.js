// =============================================================================
// FireISP 5.0 — Monthly CFDI Reconciliation Report Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up db.query mock to return three sequential result sets:
 *   1. by-status aggregate rows
 *   2. by-tipo aggregate rows
 *   3. cancellations aggregate rows
 */
function mockDbQueries({ statusRows = [], tipoRows = [], cancellationRows = [] } = {}) {
  db.query
    .mockResolvedValueOnce([statusRows])
    .mockResolvedValueOnce([tipoRows])
    .mockResolvedValueOnce([cancellationRows]);
}

// ---------------------------------------------------------------------------
// getReconciliationReport()
// ---------------------------------------------------------------------------

describe('getReconciliationReport()', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Period boundary construction
  // -------------------------------------------------------------------------
  describe('period boundaries', () => {
    test('constructs correct period_start for January', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 1);
      expect(result.period_start).toBe('2026-01-01');
    });

    test('constructs correct period_start for December', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 12);
      expect(result.period_start).toBe('2026-12-01');
    });

    test('period_end is last day of the requested month', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 3);
      expect(result.period_end).toBe('2026-03-31');
    });

    test('period_end is 28 for February in a non-leap year', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 2);
      expect(result.period_end).toBe('2026-02-28');
    });

    test('period_end is 29 for February in a leap year', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2024, 2);
      expect(result.period_end).toBe('2024-02-29');
    });

    test('year and month are present in the report', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.period).toEqual({ year: 2026, month: 4 });
    });
  });

  // -------------------------------------------------------------------------
  // DB query parameters
  // -------------------------------------------------------------------------
  describe('database queries', () => {
    test('passes orgId, periodStart, and periodEnd (exclusive) to each query', async () => {
      mockDbQueries();
      await cfdiService.getReconciliationReport(99, 2026, 6);

      // All three queries must receive the same three binding parameters
      const calls = db.query.mock.calls;
      expect(calls).toHaveLength(3);
      for (const [, params] of calls) {
        expect(params[0]).toBe(99);
        expect(params[1]).toBe('2026-06-01');
        expect(params[2]).toBe('2026-07-01'); // exclusive upper bound
      }
    });

    test('December wraps year correctly (upper bound is Jan 1 of next year)', async () => {
      mockDbQueries();
      await cfdiService.getReconciliationReport(1, 2026, 12);

      for (const [, params] of db.query.mock.calls) {
        expect(params[2]).toBe('2027-01-01');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Issued totals
  // -------------------------------------------------------------------------
  describe('issued totals', () => {
    test('sums counts and amounts across all status rows', async () => {
      mockDbQueries({
        statusRows: [
          { sat_status: 'vigente',        count: 100, subtotal: 80000, total_impuestos: 12800, total: 92800 },
          { sat_status: 'cancelado',      count: 10,  subtotal: 5000,  total_impuestos: 800,   total: 5800  },
          { sat_status: 'cancel_pending', count: 5,   subtotal: 2000,  total_impuestos: 320,   total: 2320  },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.issued.count).toBe(115);
      expect(result.issued.subtotal).toBeCloseTo(87000);
      expect(result.issued.total_impuestos).toBeCloseTo(13920);
      expect(result.issued.total).toBeCloseTo(100920);
    });

    test('returns zero totals when no documents were issued', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.issued).toEqual({ count: 0, subtotal: 0, total_impuestos: 0, total: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // by_status breakdown
  // -------------------------------------------------------------------------
  describe('by_status breakdown', () => {
    test('populates known statuses from query results', async () => {
      mockDbQueries({
        statusRows: [
          { sat_status: 'vigente',   count: 50, subtotal: 40000, total_impuestos: 6400, total: 46400 },
          { sat_status: 'cancelado', count: 3,  subtotal: 1500,  total_impuestos: 240,  total: 1740  },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.by_status.vigente.count).toBe(50);
      expect(result.by_status.cancelado.count).toBe(3);
    });

    test('defaults missing statuses to zero', async () => {
      mockDbQueries({
        statusRows: [
          { sat_status: 'vigente', count: 20, subtotal: 10000, total_impuestos: 1600, total: 11600 },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.by_status.cancelado).toEqual({ count: 0, subtotal: 0, total_impuestos: 0, total: 0 });
      expect(result.by_status.cancel_pending).toEqual({ count: 0, subtotal: 0, total_impuestos: 0, total: 0 });
    });

    test('all three known statuses are always present in the output', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.by_status).toHaveProperty('vigente');
      expect(result.by_status).toHaveProperty('cancelado');
      expect(result.by_status).toHaveProperty('cancel_pending');
    });
  });

  // -------------------------------------------------------------------------
  // by_tipo breakdown
  // -------------------------------------------------------------------------
  describe('by_tipo breakdown', () => {
    test('maps tipo_comprobante rows to by_tipo object', async () => {
      mockDbQueries({
        tipoRows: [
          { tipo_comprobante: 'I', count: 80, subtotal: 70000, total_impuestos: 11200, total: 81200 },
          { tipo_comprobante: 'E', count: 5,  subtotal: 3000,  total_impuestos: 480,   total: 3480  },
          { tipo_comprobante: 'P', count: 30, subtotal: 0,     total_impuestos: 0,     total: 0     },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.by_tipo.I.count).toBe(80);
      expect(result.by_tipo.E.count).toBe(5);
      expect(result.by_tipo.P.count).toBe(30);
    });

    test('by_tipo is empty object when no rows returned', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.by_tipo).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation acknowledgment breakdown
  // -------------------------------------------------------------------------
  describe('cancellations breakdown', () => {
    test('maps cancellation_status rows to breakdown object', async () => {
      mockDbQueries({
        cancellationRows: [
          { cancellation_status: 'accepted', count: 8 },
          { cancellation_status: 'rejected', count: 2 },
          { cancellation_status: 'pending',  count: 5 },
          { cancellation_status: 'cancelled_by_timeout', count: 1 },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.cancellations.accepted_by_sat).toBe(8);
      expect(result.cancellations.rejected_by_sat).toBe(2);
      expect(result.cancellations.pending_sat_response).toBe(5);
      expect(result.cancellations.timed_out).toBe(1);
    });

    test('defaults all cancellation counts to zero when no rows returned', async () => {
      mockDbQueries();
      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.cancellations).toEqual({
        accepted_by_sat:      0,
        rejected_by_sat:      0,
        pending_sat_response: 0,
        timed_out:            0,
      });
    });

    test('only accepted cancellations are counted as SAT acknowledged', async () => {
      mockDbQueries({
        cancellationRows: [
          { cancellation_status: 'accepted', count: 3 },
          { cancellation_status: 'pending',  count: 7 },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(result.cancellations.accepted_by_sat).toBe(3);
      expect(result.cancellations.pending_sat_response).toBe(7);
      expect(result.cancellations.rejected_by_sat).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Numeric coercion (DB may return strings)
  // -------------------------------------------------------------------------
  describe('numeric coercion', () => {
    test('coerces string counts and amounts from the database', async () => {
      mockDbQueries({
        statusRows: [
          { sat_status: 'vigente', count: '42', subtotal: '30000.00', total_impuestos: '4800.00', total: '34800.00' },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);
      expect(typeof result.issued.count).toBe('number');
      expect(result.issued.count).toBe(42);
      expect(result.by_status.vigente.subtotal).toBe(30000);
    });
  });

  // -------------------------------------------------------------------------
  // Full integration-style scenario
  // -------------------------------------------------------------------------
  describe('full report scenario', () => {
    test('returns a complete, correctly shaped report object', async () => {
      mockDbQueries({
        statusRows: [
          { sat_status: 'vigente',        count: 120, subtotal: 100000, total_impuestos: 16000, total: 116000 },
          { sat_status: 'cancelado',      count: 8,   subtotal: 4000,   total_impuestos: 640,   total: 4640  },
          { sat_status: 'cancel_pending', count: 2,   subtotal: 1000,   total_impuestos: 160,   total: 1160  },
        ],
        tipoRows: [
          { tipo_comprobante: 'I', count: 100, subtotal: 90000, total_impuestos: 14400, total: 104400 },
          { tipo_comprobante: 'P', count: 30,  subtotal: 0,     total_impuestos: 0,     total: 0      },
        ],
        cancellationRows: [
          { cancellation_status: 'accepted', count: 6 },
          { cancellation_status: 'pending',  count: 4 },
        ],
      });

      const result = await cfdiService.getReconciliationReport(1, 2026, 4);

      expect(result).toMatchObject({
        period:       { year: 2026, month: 4 },
        period_start: '2026-04-01',
        period_end:   '2026-04-30',
        issued: {
          count:           130,
          subtotal:        105000,
          total_impuestos: 16800,
          total:           121800,
        },
        by_status: {
          vigente:        { count: 120 },
          cancelado:      { count: 8  },
          cancel_pending: { count: 2  },
        },
        by_tipo: {
          I: { count: 100 },
          P: { count: 30  },
        },
        cancellations: {
          accepted_by_sat:      6,
          rejected_by_sat:      0,
          pending_sat_response: 4,
          timed_out:            0,
        },
      });
    });
  });
});
