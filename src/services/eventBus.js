// =============================================================================
// FireISP 5.0 — Event Bus
// =============================================================================
// Simple in-process pub/sub event bus for triggering notifications and
// side-effects on business events (invoice created, payment received, etc.).
// =============================================================================

const logger = require('../utils/logger');

/** @type {Map<string, Function[]>} */
const listeners = new Map();

/**
 * Register a listener for an event.
 * @param {string} event - Event name (e.g. 'invoice.created')
 * @param {Function} handler - Async handler function
 */
function on(event, handler) {
  if (!listeners.has(event)) {
    listeners.set(event, []);
  }
  listeners.get(event).push(handler);
}

/**
 * Emit an event. All registered handlers are called asynchronously.
 * Errors in handlers are logged but do not propagate.
 * @param {string} event - Event name
 * @param {object} data - Event payload
 */
async function emit(event, data) {
  const handlers = listeners.get(event) || [];
  const wildcardHandlers = listeners.get('*') || [];
  const allHandlers = [...handlers, ...wildcardHandlers];

  for (const handler of allHandlers) {
    try {
      await handler({ event, ...data });
    } catch (err) {
      logger.error({ err, event }, 'Event handler error');
    }
  }
}

/**
 * Remove all listeners (useful for testing).
 */
function removeAllListeners() {
  listeners.clear();
}

/**
 * Get count of registered listeners.
 */
function listenerCount(event) {
  if (event) return (listeners.get(event) || []).length;
  let total = 0;
  for (const handlers of listeners.values()) total += handlers.length;
  return total;
}

module.exports = { on, emit, removeAllListeners, listenerCount };
