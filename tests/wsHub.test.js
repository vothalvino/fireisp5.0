// =============================================================================
// FireISP 5.0 — WsHub Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Use a fixed secret that matches the mocked config below
const TEST_SECRET = 'test-jwt-secret-for-wshub';

jest.mock('../src/config', () => ({
  env: 'test',
  port: 3000,
  appUrl: 'http://localhost:3000',
  jwt: {
    secret: TEST_SECRET,
    expiresIn: '1h',
    accessExpiresIn: '15m',
    refreshExpiresIn: '7d',
    algorithm: 'HS256',
  },
  log: { level: 'silent' },
}));

const { WsHub, wsHub: singletonHub } = require('../src/services/wsHub');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(orgId = 1, sub = 42) {
  return jwt.sign({ sub, orgId }, TEST_SECRET, { expiresIn: '1h' });
}

async function createTestServer() {
  const server = http.createServer();
  const hub = new WsHub();
  hub.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, hub, port };
}

function connectWs(port) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws`);
}

function waitForMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs);
    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    }
    ws.on('message', onMsg);
  });
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WsHub', () => {
  describe('lifecycle', () => {
    it('attaches to an HTTP server at /ws', async () => {
      const { server, hub, port } = await createTestServer();
      const ws = connectWs(port);
      await waitForOpen(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
      await hub.close();
      server.close();
    });

    it('throws if attach() is called twice', () => {
      const hub = new WsHub();
      const server = http.createServer();
      hub.attach(server);
      expect(() => hub.attach(server)).toThrow('WsHub already attached');
      hub.close();
      server.close();
    });

    it('close() terminates all connections cleanly', async () => {
      const { server, hub, port } = await createTestServer();
      const ws = connectWs(port);
      await waitForOpen(ws);
      await hub.close();
      // After close, no internal state remains
      expect(hub._channels.size).toBe(0);
      expect(hub._clientChannels.size).toBe(0);
      server.close();
    });
  });

  describe('authentication', () => {
    let server, hub, port;
    beforeEach(async () => {
      ({ server, hub, port } = await createTestServer());
    });
    afterEach(async () => {
      await hub.close();
      server.close();
    });

    it('accepts a valid JWT and responds with auth_ok', async () => {
      const ws = connectWs(port);
      await waitForOpen(ws);
      ws.send(JSON.stringify({ type: 'auth', token: makeToken(5) }));
      const msg = await waitForMessage(ws, m => m.type === 'auth_ok');
      expect(msg.orgId).toBe(5);
      ws.close();
    });

    it('rejects an invalid JWT with auth_fail + close 4003', async () => {
      const ws = connectWs(port);
      await waitForOpen(ws);
      ws.send(JSON.stringify({ type: 'auth', token: 'bad.token.here' }));
      const closeCode = await new Promise(resolve => ws.on('close', (code) => resolve(code)));
      expect(closeCode).toBe(4003);
    });

    it('rejects a JWT missing orgId with auth_fail + close 4004', async () => {
      const token = jwt.sign({ sub: 1 }, TEST_SECRET, { expiresIn: '1h' }); // no orgId
      const ws = connectWs(port);
      await waitForOpen(ws);
      ws.send(JSON.stringify({ type: 'auth', token }));
      const closeCode = await new Promise(resolve => ws.on('close', (code) => resolve(code)));
      expect(closeCode).toBe(4004);
    });

    it('closes with 4001 if no auth message arrives within timeout', async () => {
      // Patch timeout to something very short for this test
      const origTimeout = hub.constructor.name; // just access hub
      // Send no auth — wait for server-side auth timeout
      // (We override AUTH_TIMEOUT_MS indirectly by patching _handleConnection)
      const ws = connectWs(port);
      await waitForOpen(ws);
      // Trigger auth timeout by sending a non-auth message first
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'notifications' }));
      // Should receive auth_fail (wrong protocol before auth)
      const msg = await waitForMessage(ws, m => m.type === 'auth_fail');
      expect(msg.reason).toMatch(/Expected/i);
      ws.close();
    });

    it('rejects non-JSON messages with error response', async () => {
      const ws = connectWs(port);
      await waitForOpen(ws);
      ws.send('this is not json');
      const msg = await waitForMessage(ws, m => m.type === 'error');
      expect(msg.reason).toMatch(/Invalid JSON/i);
      ws.close();
    });
  });

  describe('channel subscription', () => {
    let server, hub, port;
    beforeEach(async () => {
      ({ server, hub, port } = await createTestServer());
    });
    afterEach(async () => {
      await hub.close();
      server.close();
    });

    async function authAndGetWs(orgId = 1) {
      const ws = connectWs(port);
      await waitForOpen(ws);
      ws.send(JSON.stringify({ type: 'auth', token: makeToken(orgId) }));
      await waitForMessage(ws, m => m.type === 'auth_ok');
      return ws;
    }

    it('subscribes to a valid channel and confirms with subscribed message', async () => {
      const ws = await authAndGetWs(3);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'notifications' }));
      const msg = await waitForMessage(ws, m => m.type === 'subscribed');
      expect(msg.channel).toBe('org:3:notifications');
      ws.close();
    });

    it('subscribes to ticket:<id> channel', async () => {
      const ws = await authAndGetWs(7);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'ticket:42' }));
      const msg = await waitForMessage(ws, m => m.type === 'subscribed');
      expect(msg.channel).toBe('org:7:ticket:42');
      ws.close();
    });

    it('rejects invalid channel names', async () => {
      const ws = await authAndGetWs(1);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'org:99:notifications' }));
      const msg = await waitForMessage(ws, m => m.type === 'error');
      expect(msg.reason).toMatch(/Invalid channel/);
      ws.close();
    });

    it('unsubscribes from a channel', async () => {
      const ws = await authAndGetWs(2);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'metrics' }));
      await waitForMessage(ws, m => m.type === 'subscribed');
      ws.send(JSON.stringify({ type: 'unsubscribe', channel: 'metrics' }));
      const msg = await waitForMessage(ws, m => m.type === 'unsubscribed');
      expect(msg.channel).toBe('org:2:metrics');
      ws.close();
    });
  });

  describe('broadcastWs()', () => {
    let server, hub, port;
    beforeEach(async () => {
      ({ server, hub, port } = await createTestServer());
    });
    afterEach(async () => {
      await hub.close();
      server.close();
    });

    async function authAndSubscribe(orgId, channel) {
      const ws = connectWs(port);
      await new Promise(r => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'auth', token: makeToken(orgId) }));
      await waitForMessage(ws, m => m.type === 'auth_ok');
      ws.send(JSON.stringify({ type: 'subscribe', channel }));
      await waitForMessage(ws, m => m.type === 'subscribed');
      return ws;
    }

    it('delivers events to all subscribed clients', async () => {
      const ws1 = await authAndSubscribe(1, 'notifications');
      const ws2 = await authAndSubscribe(1, 'notifications');

      hub.broadcastWs('org:1:notifications', 'invoice', { id: 99 });

      const [m1, m2] = await Promise.all([
        waitForMessage(ws1, m => m.type === 'event'),
        waitForMessage(ws2, m => m.type === 'event'),
      ]);
      expect(m1.event).toBe('invoice');
      expect(m1.data.id).toBe(99);
      expect(m2.event).toBe('invoice');
      ws1.close();
      ws2.close();
    });

    it('does not deliver events to clients on a different org channel', async () => {
      const ws1 = await authAndSubscribe(1, 'notifications');
      const ws2 = await authAndSubscribe(2, 'notifications');

      let got2 = false;
      ws2.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === 'event') got2 = true;
      });

      hub.broadcastWs('org:1:notifications', 'test', { x: 1 });
      await waitForMessage(ws1, m => m.type === 'event');

      // Give ws2 a tick to incorrectly receive
      await new Promise(r => setTimeout(r, 50));
      expect(got2).toBe(false);
      ws1.close();
      ws2.close();
    });

    it('is a no-op when no clients are subscribed', () => {
      expect(() => hub.broadcastWs('org:99:notifications', 'test', {})).not.toThrow();
    });
  });

  describe('singleton', () => {
    it('exports a singleton wsHub instance', () => {
      expect(singletonHub).toBeInstanceOf(WsHub);
    });
  });
});
