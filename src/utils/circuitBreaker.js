// =============================================================================
// FireISP 5.0 — Circuit Breaker Utility
// =============================================================================
// Reusable circuit breaker pattern for external service calls.
// Tracks consecutive failures and opens the circuit when a threshold is reached.
// After a cooldown period, allows a single probe request through.
// =============================================================================

const { ExternalServiceError } = require('./errors');

/**
 * Create a circuit breaker instance.
 *
 * @param {object} opts
 * @param {string} opts.name - Name of the service (used in error messages)
 * @param {number} [opts.threshold=5] - Number of consecutive failures to open the circuit
 * @param {number} [opts.resetMs=60000] - Cooldown period in milliseconds before allowing a probe
 * @returns {{ call: Function, getState: Function, reset: Function }}
 */
function createCircuitBreaker({ name, threshold = 5, resetMs = 60000 } = {}) {
  let failures = 0;
  let lastFailure = 0;
  let state = 'closed'; // closed | open | half-open

  function isOpen() {
    if (failures < threshold) {
      state = 'closed';
      return false;
    }
    // Allow a probe after cooldown
    if (Date.now() - lastFailure > resetMs) {
      state = 'half-open';
      return false;
    }
    state = 'open';
    return true;
  }

  function recordSuccess() {
    failures = 0;
    state = 'closed';
  }

  function recordFailure() {
    failures++;
    lastFailure = Date.now();
    if (failures >= threshold) {
      state = 'open';
    }
  }

  /**
   * Execute a function through the circuit breaker.
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of fn
   * @throws {ExternalServiceError} If the circuit is open
   */
  async function call(fn) {
    if (isOpen()) {
      throw new ExternalServiceError(
        `${name} circuit breaker is open — too many consecutive failures`,
      );
    }

    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      recordFailure();
      throw err;
    }
  }

  function getState() {
    isOpen(); // Refresh state
    return { name, state, failures, threshold, resetMs, lastFailure };
  }

  function reset() {
    failures = 0;
    lastFailure = 0;
    state = 'closed';
  }

  return { call, getState, reset, recordSuccess, recordFailure, isOpen };
}

module.exports = { createCircuitBreaker };
