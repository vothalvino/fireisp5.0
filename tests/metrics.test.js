// =============================================================================
// FireISP 5.0 — Prometheus Metrics Tests
// =============================================================================

const { metricsMiddleware, counters, recordDbQuery, dbQuerySamples } = require('../src/routes/metrics');

describe('Prometheus Metrics', () => {
  beforeEach(() => {
    counters.http_requests_total = 0;
    counters.http_request_errors_total = 0;
    dbQuerySamples.clear();
  });

  describe('metricsMiddleware()', () => {
    it('increments request counter', () => {
      const req = { method: 'GET', path: '/api/clients', route: null };
      const res = {
        statusCode: 200,
        on: jest.fn((event, handler) => {
          if (event === 'finish') handler();
        }),
      };
      const next = jest.fn();

      metricsMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(counters.http_requests_total).toBe(1);
    });

    it('increments error counter for 4xx/5xx', () => {
      const req = { method: 'GET', path: '/api/notfound', route: null };
      const res = {
        statusCode: 404,
        on: jest.fn((event, handler) => {
          if (event === 'finish') handler();
        }),
      };
      const next = jest.fn();

      metricsMiddleware(req, res, next);

      expect(counters.http_request_errors_total).toBe(1);
    });

    it('does not increment error counter for 2xx', () => {
      const req = { method: 'POST', path: '/api/clients', route: { path: '/clients' } };
      const res = {
        statusCode: 201,
        on: jest.fn((event, handler) => {
          if (event === 'finish') handler();
        }),
      };
      const next = jest.fn();

      metricsMiddleware(req, res, next);

      expect(counters.http_request_errors_total).toBe(0);
    });
  });

  describe('recordDbQuery()', () => {
    it('records a DB query sample for a given operation', () => {
      recordDbQuery(0.012, 'SELECT');
      expect(dbQuerySamples.has('SELECT')).toBe(true);
      expect(dbQuerySamples.get('SELECT')).toHaveLength(1);
      expect(dbQuerySamples.get('SELECT')[0]).toBe(0.012);
    });

    it('defaults operation to OTHER when not provided', () => {
      recordDbQuery(0.005);
      expect(dbQuerySamples.has('OTHER')).toBe(true);
      expect(dbQuerySamples.get('OTHER')[0]).toBe(0.005);
    });

    it('accumulates multiple samples for the same operation', () => {
      recordDbQuery(0.010, 'INSERT');
      recordDbQuery(0.020, 'INSERT');
      recordDbQuery(0.030, 'INSERT');
      expect(dbQuerySamples.get('INSERT')).toHaveLength(3);
    });

    it('tracks separate samples per operation', () => {
      recordDbQuery(0.010, 'SELECT');
      recordDbQuery(0.020, 'INSERT');
      recordDbQuery(0.015, 'UPDATE');
      recordDbQuery(0.008, 'DELETE');
      expect(dbQuerySamples.get('SELECT')).toHaveLength(1);
      expect(dbQuerySamples.get('INSERT')).toHaveLength(1);
      expect(dbQuerySamples.get('UPDATE')).toHaveLength(1);
      expect(dbQuerySamples.get('DELETE')).toHaveLength(1);
    });

    it('evicts oldest sample when limit of 2000 is exceeded', () => {
      for (let i = 0; i < 2001; i++) {
        recordDbQuery(i * 0.0001, 'SELECT');
      }
      const samples = dbQuerySamples.get('SELECT');
      expect(samples).toHaveLength(2000);
      // First sample (0) should have been evicted; the second (0.0001) is now index 0
      expect(samples[0]).toBeCloseTo(0.0001, 5);
    });
  });
});
