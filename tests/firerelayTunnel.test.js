// =============================================================================
// FireISP 5.0 — FireRelay Tunnel Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// Provide tunnel config in tests
jest.mock('../src/config/firerelay', () => ({
  mode: 'master',
  nodes: [],
  healthInterval: 30000,
  requestTimeout: 5000,
  maxRetries: 2,
  masterUrl: '',
  nodeId: '',
  autoIncrementOffset: 1,
  maxClients: 10000,
  maxDevices: 3000,
  tunnelSecret: 'test-secret',
  tunnelCommandTimeout: 2000,
  tunnelPingInterval: 60000,
}));

const http = require('http');
const WebSocket = require('ws');
const db = require('../src/config/database');
const { TunnelServer } = require('../src/services/firerelayTunnel');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start an HTTP server with the tunnel attached, return { server, tunnel, port }.
 */
async function createTestServer() {
  const server = http.createServer();
  const tunnel = new TunnelServer();
  tunnel.attach(server);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, tunnel, port };
}

/**
 * Connect a WebSocket to the tunnel endpoint.
 */
function connectWs(port) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws/firerelay`);
}

/**
 * Wait for a specific message type from a WebSocket.
 */
function waitForMessage(ws, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${type}"`)), timeoutMs);

    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    }

    ws.on('message', onMsg);
  });
}

/**
 * Authenticate a WebSocket client with the tunnel.
 */
async function authenticate(ws, nodeId = 'test-node', token = 'test-secret') {
  await new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'auth', node_id: nodeId, token }));
  return waitForMessage(ws, 'auth_ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TunnelServer', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    db.query.mockResolvedValue([[]]);
  });

  // ─── attach() ─────────────────────────────────────────────────────────────

  describe('attach()', () => {
    test('attaches to HTTP server and accepts connections', async () => {
      const { server, tunnel, port } = await createTestServer();
      try {
        const ws = connectWs(port);
        const opened = await new Promise((res, rej) => {
          ws.once('open', res);
          ws.once('error', rej);
        });
        expect(opened).toBeUndefined(); // open event fires with no args
        ws.close();
      } finally {
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('throws if attached twice', async () => {
      const { server, tunnel } = await createTestServer();
      try {
        expect(() => tunnel.attach(server)).toThrow('already attached');
      } finally {
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });
  });

  // ─── auth ─────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    test('auth_ok with correct credentials', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        const response = await authenticate(ws);
        expect(response.type).toBe('auth_ok');
        expect(tunnel.isConnected('test-node')).toBe(true);
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('auth_fail with wrong token', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
        ws.send(JSON.stringify({ type: 'auth', node_id: 'node1', token: 'wrong-secret' }));
        const msg = await waitForMessage(ws, 'auth_fail');
        expect(msg.reason).toMatch(/Invalid token/);
        expect(tunnel.isConnected('node1')).toBe(false);
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('auth_fail when non-auth message is sent first', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
        ws.send(JSON.stringify({ type: 'command', method: 'foo' }));
        const msg = await waitForMessage(ws, 'auth_fail');
        expect(msg.reason).toMatch(/Expected auth message/);
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('invalid JSON is rejected with error message', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
        ws.send('not json at all');
        const msg = await waitForMessage(ws, 'error');
        expect(msg.reason).toMatch(/Invalid JSON/);
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('auth_fail with empty node_id', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
        ws.send(JSON.stringify({ type: 'auth', node_id: '', token: 'test-secret' }));
        const msg = await waitForMessage(ws, 'auth_fail');
        expect(msg.reason).toMatch(/Invalid node_id/);
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('second connection with same node_id replaces the first', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws1 = connectWs(port);
      const ws2 = connectWs(port);
      try {
        await authenticate(ws1, 'shared-node');
        expect(tunnel.isConnected('shared-node')).toBe(true);

        // First socket should be closed when second one authenticates
        const ws1Closed = new Promise(r => ws1.once('close', r));
        await authenticate(ws2, 'shared-node');
        await ws1Closed;

        expect(tunnel.isConnected('shared-node')).toBe(true);
      } finally {
        ws1.close();
        ws2.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });
  });

  // ─── connectedAgents() ────────────────────────────────────────────────────

  describe('connectedAgents()', () => {
    test('returns list of connected agent ids', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws1 = connectWs(port);
      const ws2 = connectWs(port);
      try {
        await authenticate(ws1, 'node-A');
        await authenticate(ws2, 'node-B');
        const agents = tunnel.connectedAgents();
        expect(agents).toContain('node-A');
        expect(agents).toContain('node-B');
        expect(agents).toHaveLength(2);
      } finally {
        ws1.close();
        ws2.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('agent removed after disconnect', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws, 'node-X');
        expect(tunnel.isConnected('node-X')).toBe(true);

        const closed = new Promise(r => ws.once('close', r));
        ws.close();
        await closed;

        expect(tunnel.isConnected('node-X')).toBe(false);
        expect(tunnel.connectedAgents()).not.toContain('node-X');
      } finally {
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });
  });

  // ─── sendCommand() ────────────────────────────────────────────────────────

  describe('sendCommand()', () => {
    test('sends command and resolves with agent response', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws);

        // Simulate agent echoing back a response
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'command') {
            ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, data: { echo: msg.params } }));
          }
        });

        const result = await tunnel.sendCommand('test-node', 'test.method', { key: 'value' });
        expect(result).toEqual({ echo: { key: 'value' } });
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('rejects if agent returns ok=false', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws);

        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'command') {
            ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: false, error: 'device busy' }));
          }
        });

        await expect(tunnel.sendCommand('test-node', 'test.fail', {})).rejects.toThrow('device busy');
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('rejects if agent is not connected', async () => {
      const { server, tunnel } = await createTestServer();
      try {
        await expect(tunnel.sendCommand('ghost-node', 'test.method', {}))
          .rejects.toThrow('not connected');
      } finally {
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('rejects with timeout if agent does not respond', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws);
        // Agent receives command but never responds

        await expect(
          tunnel.sendCommand('test-node', 'timeout.method', {}, 100),
        ).rejects.toThrow(/timed out/);
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('ignores response with unknown command id', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws);

        // Send a rogue response that doesn't match any pending command
        ws.send(JSON.stringify({ type: 'response', id: 'no-such-id', ok: true, data: {} }));
        // No error should be thrown — just silently ignored
        await new Promise(r => setTimeout(r, 50));
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });
  });

  // ─── events ───────────────────────────────────────────────────────────────

  describe('agent:connect / agent:disconnect events', () => {
    test('emits agent:connect on successful auth', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        const connectEvent = new Promise(r => tunnel.once('agent:connect', r));
        await authenticate(ws, 'event-node');
        const nodeId = await connectEvent;
        expect(nodeId).toBe('event-node');
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('emits agent:disconnect on socket close', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws, 'event-node-2');
        const disconnectEvent = new Promise(r => tunnel.once('agent:disconnect', r));
        ws.close();
        const nodeId = await disconnectEvent;
        expect(nodeId).toBe('event-node-2');
      } finally {
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });
  });

  // ─── DB hooks ─────────────────────────────────────────────────────────────

  describe('DB status updates', () => {
    test('updates node status to active on agent connect', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws, 'db-node');
        // Allow async DB call to settle
        await new Promise(r => setTimeout(r, 50));
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining("status = 'active'"),
          ['db-node'],
        );
      } finally {
        ws.close();
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });

    test('updates node status to offline on agent disconnect', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws, 'db-node-2');
        const closed = new Promise(r => ws.once('close', r));
        ws.close();
        await closed;
        await new Promise(r => setTimeout(r, 50));
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining("status = 'offline'"),
          ['db-node-2'],
        );
      } finally {
        await tunnel.close();
        await new Promise(r => server.close(r));
      }
    });
  });

  // ─── close() ──────────────────────────────────────────────────────────────

  describe('close()', () => {
    test('rejects pending commands on close', async () => {
      const { server, tunnel, port } = await createTestServer();
      const ws = connectWs(port);
      try {
        await authenticate(ws);
        // Start a command but don't respond
        const cmdPromise = tunnel.sendCommand('test-node', 'slow.op', {}, 10000);
        // Attach rejection handler before closing to avoid unhandledRejection
        const assertion = expect(cmdPromise).rejects.toThrow(/closing/);
        // Close the tunnel — should reject pending commands immediately
        await tunnel.close();
        await assertion;
      } finally {
        ws.close();
        await new Promise(r => server.close(r));
      }
    });

    test('no-op when called on a non-attached tunnel', async () => {
      const tunnel = new TunnelServer();
      await expect(tunnel.close()).resolves.toBeUndefined();
    });
  });
});
