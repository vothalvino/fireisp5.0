// =============================================================================
// FireISP 5.0 — SSE Events Tests
// =============================================================================

jest.mock('../src/config/database');
const { broadcast, getChannel, channels, sendEvent } = require('../src/routes/events');

describe('SSE Events Module', () => {
  beforeEach(() => {
    channels.clear();
  });

  describe('getChannel()', () => {
    it('creates a new channel set on first access', () => {
      const clients = getChannel('test:channel');
      expect(clients).toBeInstanceOf(Set);
      expect(clients.size).toBe(0);
    });

    it('returns the same set on subsequent access', () => {
      const first = getChannel('test:channel');
      first.add('client1');
      const second = getChannel('test:channel');
      expect(second.size).toBe(1);
      expect(second).toBe(first);
    });
  });

  describe('broadcast()', () => {
    it('sends events to all clients in a channel', () => {
      const mockRes1 = { write: jest.fn() };
      const mockRes2 = { write: jest.fn() };
      const clients = getChannel('org:1:notifications');
      clients.add(mockRes1);
      clients.add(mockRes2);

      broadcast('org:1:notifications', 'test', { message: 'hello' });

      expect(mockRes1.write).toHaveBeenCalledWith(
        'event: test\ndata: {"message":"hello"}\n\n',
      );
      expect(mockRes2.write).toHaveBeenCalledWith(
        'event: test\ndata: {"message":"hello"}\n\n',
      );
    });

    it('does nothing when channel has no subscribers', () => {
      // Should not throw
      broadcast('nonexistent:channel', 'test', { data: 1 });
    });

    it('removes clients that throw on write', () => {
      const goodRes = { write: jest.fn() };
      const badRes = { write: jest.fn(() => { throw new Error('connection closed'); }) };
      const clients = getChannel('org:1:notifications');
      clients.add(goodRes);
      clients.add(badRes);

      broadcast('org:1:notifications', 'test', { data: 1 });

      expect(goodRes.write).toHaveBeenCalled();
      expect(clients.size).toBe(1); // bad client removed
      expect(clients.has(badRes)).toBe(false);
    });
  });

  describe('sendEvent()', () => {
    it('writes SSE-formatted event to response', () => {
      const mockRes = { write: jest.fn() };
      sendEvent(mockRes, 'notification', { type: 'invoice', id: 42 });
      expect(mockRes.write).toHaveBeenCalledWith(
        'event: notification\ndata: {"type":"invoice","id":42}\n\n',
      );
    });
  });
});
