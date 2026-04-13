// =============================================================================
// FireISP 5.0 — CFDI Circuit Breaker Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const cfdiService = require('../src/services/cfdiService');

describe('cfdiService circuit breaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the circuit breaker state
    cfdiService.circuitBreaker.failures = 0;
    cfdiService.circuitBreaker.lastFailure = 0;
  });

  test('circuit breaker is closed by default', () => {
    expect(cfdiService.circuitBreaker.isOpen()).toBe(false);
  });

  test('circuit breaker opens after threshold failures', () => {
    for (let i = 0; i < cfdiService.circuitBreaker.threshold; i++) {
      cfdiService.circuitBreaker.recordFailure();
    }
    expect(cfdiService.circuitBreaker.isOpen()).toBe(true);
  });

  test('circuit breaker resets after success', () => {
    for (let i = 0; i < 3; i++) {
      cfdiService.circuitBreaker.recordFailure();
    }
    cfdiService.circuitBreaker.recordSuccess();
    expect(cfdiService.circuitBreaker.isOpen()).toBe(false);
    expect(cfdiService.circuitBreaker.failures).toBe(0);
  });

  test('circuit breaker allows probe after reset period', () => {
    for (let i = 0; i < cfdiService.circuitBreaker.threshold; i++) {
      cfdiService.circuitBreaker.recordFailure();
    }
    expect(cfdiService.circuitBreaker.isOpen()).toBe(true);

    // Simulate time passing beyond resetMs
    cfdiService.circuitBreaker.lastFailure = Date.now() - cfdiService.circuitBreaker.resetMs - 1;
    expect(cfdiService.circuitBreaker.isOpen()).toBe(false);
  });

  test('stamp rejects when circuit breaker is open', async () => {
    for (let i = 0; i < cfdiService.circuitBreaker.threshold; i++) {
      cfdiService.circuitBreaker.recordFailure();
    }

    await expect(cfdiService.stamp(1)).rejects.toThrow('circuit breaker is open');
  });
});
