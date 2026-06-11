// =============================================================================
// FireISP 5.0 — NAS Health Service Tests
// =============================================================================
// Tests RADIUS Status-Server probing (RFC 5997) and batch health check logic.
// Mocks dgram to avoid real UDP traffic.
// =============================================================================

jest.mock('dgram');
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

// eventBus is optional in nasHealthService; mock it so require() doesn't fail
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
}), { virtual: true });

const dgram = require('dgram');
const db = require('../src/config/database');
const { probeNas, runHealthChecks } = require('../src/services/nasHealthService');

// ---------------------------------------------------------------------------
// Shared mock socket factory
// ---------------------------------------------------------------------------

/**
 * Build a mock dgram socket that immediately delivers a RADIUS response buffer
 * to any registered 'message' handler (via process.nextTick).
 */
function makeMockSocket(responseBuffer) {
  const handlers = {};
  const socket = {
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
      if (event === 'message' && responseBuffer) {
        process.nextTick(() => cb(responseBuffer));
      }
    }),
    send: jest.fn(),
    close: jest.fn(),
  };
  return socket;
}

describe('nasHealthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // probeNas
  // ---------------------------------------------------------------------------
  describe('probeNas()', () => {
    test('returns up=true when NAS responds with Access-Accept (code 2)', async () => {
      // buf[0] = 2 (Access-Accept), followed by 3 padding bytes
      const responseBuffer = Buffer.from([2, 0, 0, 12]);
      dgram.createSocket.mockReturnValue(makeMockSocket(responseBuffer));

      const result = await probeNas({
        id: 1,
        ip_address: '10.0.0.1',
        coa_port: 3799,
        secret: 'testing',
      });

      expect(result.up).toBe(true);
      expect(result.responseCode).toBe(2);
      expect(typeof result.responseMs).toBe('number');
    });

    test('returns up=true when NAS responds with Access-Reject (code 3)', async () => {
      // code 3 = Access-Reject — also means the NAS is reachable
      const responseBuffer = Buffer.from([3, 0, 0, 12]);
      dgram.createSocket.mockReturnValue(makeMockSocket(responseBuffer));

      const result = await probeNas({
        id: 2,
        ip_address: '10.0.0.2',
        coa_port: 3799,
        secret: 'testing',
      });

      expect(result.up).toBe(true);
      expect(result.responseCode).toBe(3);
    });

    test('returns up=false when NAS secret is not configured', async () => {
      const result = await probeNas({
        id: 3,
        ip_address: '10.0.0.3',
        coa_port: 3799,
        secret: '',
      });

      expect(result.up).toBe(false);
      expect(result.responseCode).toBeNull();
    });

    test('returns up=false when NAS secret is null', async () => {
      const result = await probeNas({
        id: 4,
        ip_address: '10.0.0.4',
        coa_port: null,
        secret: null,
      });

      expect(result.up).toBe(false);
    });

    test('returns up=false on socket error', async () => {
      const handlers = {};
      const socket = {
        on: jest.fn((event, cb) => {
          handlers[event] = cb;
          if (event === 'error') {
            process.nextTick(() => cb(new Error('ECONNREFUSED')));
          }
        }),
        send: jest.fn(),
        close: jest.fn(),
      };
      dgram.createSocket.mockReturnValue(socket);

      const result = await probeNas({
        id: 5,
        ip_address: '10.0.0.5',
        coa_port: 3799,
        secret: 'testing',
      });

      expect(result.up).toBe(false);
      expect(result.responseCode).toBeNull();
    });

    test('returns up=false when probe times out', async () => {
      jest.useFakeTimers();

      // Socket that never fires the 'message' event
      const socket = {
        on: jest.fn(),
        send: jest.fn(),
        close: jest.fn(),
      };
      dgram.createSocket.mockReturnValue(socket);

      const probePromise = probeNas({
        id: 6,
        ip_address: '10.0.0.6',
        coa_port: 3799,
        secret: 'testing',
      });

      // Advance past the 5-second timeout
      jest.advanceTimersByTime(5001);

      const result = await probePromise;
      expect(result.up).toBe(false);
      expect(result.responseCode).toBeNull();
    });

    test('uses port 3799 as default when coa_port is null', async () => {
      const responseBuffer = Buffer.from([2, 0, 0, 12]);
      const socket = makeMockSocket(responseBuffer);
      dgram.createSocket.mockReturnValue(socket);

      await probeNas({
        id: 7,
        ip_address: '10.0.0.7',
        coa_port: null,
        secret: 'testing',
      });

      expect(socket.send).toHaveBeenCalledWith(
        expect.any(Buffer),
        3799,
        '10.0.0.7',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // runHealthChecks
  // ---------------------------------------------------------------------------
  describe('runHealthChecks()', () => {
    test('returns summary with checked=1, up=1, down=0 when NAS responds', async () => {
      db.query
        // 1. SELECT active NAS devices
        .mockResolvedValueOnce([[{
          id: 1,
          ip_address: '10.0.0.1',
          coa_port: 3799,
          secret: 'test',
          health_status: 'unknown',
          organization_id: 1,
        }]])
        // 2. UPDATE nas SET health_status
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      // Simulate Access-Accept response
      const responseBuffer = Buffer.from([2, 0, 0, 12]);
      dgram.createSocket.mockReturnValue(makeMockSocket(responseBuffer));

      const result = await runHealthChecks();

      expect(result.checked).toBe(1);
      expect(result.up).toBe(1);
      expect(result.down).toBe(0);
    });

    test('returns summary with down=1 when NAS has no secret', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 2,
          ip_address: '10.0.0.2',
          coa_port: 3799,
          secret: null,
          health_status: 'up',
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await runHealthChecks();

      expect(result.checked).toBe(1);
      expect(result.down).toBe(1);
      expect(result.up).toBe(0);
    });

    test('returns checked=0 when no active NAS devices exist', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const result = await runHealthChecks();

      expect(result.checked).toBe(0);
      expect(result.up).toBe(0);
      expect(result.down).toBe(0);
      expect(result.transitions).toEqual([]);
    });

    test('records a transition when NAS changes from "up" to "down"', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 3,
          ip_address: '10.0.0.3',
          coa_port: 3799,
          secret: null,   // no secret → probe returns down
          health_status: 'up',
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await runHealthChecks();

      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0]).toEqual({ id: 3, from: 'up', to: 'down' });
    });

    test('records a transition when NAS changes from "down" to "up"', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 4,
          ip_address: '10.0.0.4',
          coa_port: 3799,
          secret: 'test',
          health_status: 'down',
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const responseBuffer = Buffer.from([2, 0, 0, 12]);
      dgram.createSocket.mockReturnValue(makeMockSocket(responseBuffer));

      const result = await runHealthChecks();

      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0]).toEqual({ id: 4, from: 'down', to: 'up' });
    });

    test('does not record a transition when health_status is already up', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 5,
          ip_address: '10.0.0.5',
          coa_port: 3799,
          secret: 'test',
          health_status: 'up',
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const responseBuffer = Buffer.from([2, 0, 0, 12]);
      dgram.createSocket.mockReturnValue(makeMockSocket(responseBuffer));

      const result = await runHealthChecks();

      expect(result.transitions).toHaveLength(0);
    });

    test('scopes NAS query to organizationId when provided', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await runHealthChecks(42);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('organization_id = ?');
      expect(params).toContain(42);
    });

    test('updates health_status in the nas table after each probe', async () => {
      db.query
        .mockResolvedValueOnce([[{
          id: 6,
          ip_address: '10.0.0.6',
          coa_port: 3799,
          secret: 'test',
          health_status: 'unknown',
          organization_id: 1,
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const responseBuffer = Buffer.from([2, 0, 0, 12]);
      dgram.createSocket.mockReturnValue(makeMockSocket(responseBuffer));

      await runHealthChecks();

      // Second query should be the UPDATE
      const [updateSql, updateParams] = db.query.mock.calls[1];
      expect(updateSql).toContain('UPDATE nas SET health_status');
      expect(updateParams[0]).toBe('up');
      expect(updateParams[1]).toBe(6);
    });

    test('handles multiple NAS devices in one run', async () => {
      db.query
        .mockResolvedValueOnce([[
          { id: 10, ip_address: '10.0.0.10', coa_port: 3799, secret: 'test', health_status: 'unknown', organization_id: 1 },
          { id: 11, ip_address: '10.0.0.11', coa_port: 3799, secret: null,   health_status: 'unknown', organization_id: 1 },
        ]])
        // UPDATE for NAS 10
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // UPDATE for NAS 11
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      // Only the first NAS gets a real socket (NAS 11 has no secret)
      const responseBuffer = Buffer.from([2, 0, 0, 12]);
      dgram.createSocket.mockReturnValue(makeMockSocket(responseBuffer));

      const result = await runHealthChecks();

      expect(result.checked).toBe(2);
      expect(result.up).toBe(1);
      expect(result.down).toBe(1);
    });
  });
});
