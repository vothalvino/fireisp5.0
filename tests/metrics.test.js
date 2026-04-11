// =============================================================================
// FireISP 5.0 — Prometheus Metrics Tests
// =============================================================================

const { metricsMiddleware, counters } = require('../src/routes/metrics');

describe('Prometheus Metrics', () => {
  beforeEach(() => {
    counters.http_requests_total = 0;
    counters.http_request_errors_total = 0;
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
});
