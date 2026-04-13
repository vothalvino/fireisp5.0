// =============================================================================
// FireISP 5.0 — Event Bus Unit Tests
// =============================================================================

const eventBus = require('../src/services/eventBus');

describe('eventBus', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  describe('on() and emit()', () => {
    test('registers and calls a handler', async () => {
      const handler = jest.fn();
      eventBus.on('test.event', handler);
      await eventBus.emit('test.event', { key: 'value' });
      expect(handler).toHaveBeenCalledWith({ event: 'test.event', key: 'value' });
    });

    test('calls multiple handlers for the same event', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      eventBus.on('test.event', handler1);
      eventBus.on('test.event', handler2);
      await eventBus.emit('test.event', { data: 1 });
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    test('wildcard listener receives all events', async () => {
      const handler = jest.fn();
      eventBus.on('*', handler);
      await eventBus.emit('any.event', { x: 1 });
      expect(handler).toHaveBeenCalledWith({ event: 'any.event', x: 1 });
    });

    test('does not call handlers for different events', async () => {
      const handler = jest.fn();
      eventBus.on('event.a', handler);
      await eventBus.emit('event.b', {});
      expect(handler).not.toHaveBeenCalled();
    });

    test('catches and logs handler errors without propagating', async () => {
      const errorHandler = jest.fn(() => { throw new Error('handler error'); });
      const goodHandler = jest.fn();
      eventBus.on('test.event', errorHandler);
      eventBus.on('test.event', goodHandler);

      await expect(eventBus.emit('test.event', {})).resolves.not.toThrow();
      expect(goodHandler).toHaveBeenCalled();
    });

    test('emit with no listeners does not throw', async () => {
      await expect(eventBus.emit('no.listeners', {})).resolves.not.toThrow();
    });
  });

  describe('removeAllListeners()', () => {
    test('removes all listeners', async () => {
      const handler = jest.fn();
      eventBus.on('test', handler);
      eventBus.removeAllListeners();
      await eventBus.emit('test', {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount()', () => {
    test('returns count for specific event', () => {
      eventBus.on('event.a', jest.fn());
      eventBus.on('event.a', jest.fn());
      eventBus.on('event.b', jest.fn());
      expect(eventBus.listenerCount('event.a')).toBe(2);
      expect(eventBus.listenerCount('event.b')).toBe(1);
    });

    test('returns total count when no event specified', () => {
      eventBus.on('event.a', jest.fn());
      eventBus.on('event.b', jest.fn());
      expect(eventBus.listenerCount()).toBe(2);
    });

    test('returns 0 for unknown event', () => {
      expect(eventBus.listenerCount('nonexistent')).toBe(0);
    });
  });
});
