// =============================================================================
// FireISP 5.0 — Circuit Breaker Utility Tests
// =============================================================================

const { createCircuitBreaker } = require('../src/utils/circuitBreaker');

describe('createCircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = createCircuitBreaker({ name: 'TestService', threshold: 3, resetMs: 100 });
  });

  test('calls function normally when circuit is closed', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await cb.call(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalled();
  });

  test('propagates errors from the wrapped function', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.call(fn)).rejects.toThrow('fail');
  });

  test('opens circuit after threshold consecutive failures', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    // Fail 3 times (threshold)
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail');
    }

    // Circuit should now be open
    const state = cb.getState();
    expect(state.state).toBe('open');
    expect(state.failures).toBe(3);

    // Next call should fail immediately without calling fn
    fn.mockClear();
    await expect(cb.call(fn)).rejects.toThrow('circuit breaker is open');
    expect(fn).not.toHaveBeenCalled();
  });

  test('resets failures on success', async () => {
    const failFn = jest.fn().mockRejectedValue(new Error('fail'));
    const okFn = jest.fn().mockResolvedValue('ok');

    // Fail twice (below threshold)
    await expect(cb.call(failFn)).rejects.toThrow();
    await expect(cb.call(failFn)).rejects.toThrow();

    // Succeed — should reset counter
    await cb.call(okFn);

    const state = cb.getState();
    expect(state.failures).toBe(0);
    expect(state.state).toBe('closed');
  });

  test('allows probe after cooldown (half-open)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail');
    }

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 150));

    // Should allow a probe
    const probeFn = jest.fn().mockResolvedValue('recovered');
    const result = await cb.call(probeFn);
    expect(result).toBe('recovered');
    expect(probeFn).toHaveBeenCalled();
    expect(cb.getState().state).toBe('closed');
  });

  test('reset() clears all state', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe('open');

    cb.reset();
    expect(cb.getState().failures).toBe(0);
    expect(cb.getState().state).toBe('closed');
  });

  test('getState returns current circuit breaker info', () => {
    const state = cb.getState();
    expect(state.name).toBe('TestService');
    expect(state.threshold).toBe(3);
    expect(state.resetMs).toBe(100);
    expect(state.state).toBe('closed');
  });
});
