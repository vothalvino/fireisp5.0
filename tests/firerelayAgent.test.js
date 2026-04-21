// =============================================================================
// FireISP 5.0 — FireRelay Agent Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

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
  tunnelAuthTimeout: 10000,
  tunnelCommandTimeout: 2000,
  tunnelPingInterval: 60000,
}));

const http = require('http');
const db = require('../src/config/database');
const { TunnelServer } = require('../src/services/firerelayTunnel');
const FireRelayAgent = require('../src/services/firerelayAgent');

async function createTestServer() {
  const server = http.createServer();
  const tunnel = new TunnelServer();
  tunnel.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, tunnel, port };
}

async function waitFor(fn, timeoutMs = 3000, stepMs = 25) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, stepMs));
  }
  throw new Error('Timed out waiting for condition');
}

describe('FireRelayAgent', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    db.query.mockResolvedValue([[]]);
  });

  test('connects and authenticates to tunnel', async () => {
    const { server, tunnel, port } = await createTestServer();
    const agent = new FireRelayAgent({
      nodeId: 'agent-A',
      token: 'test-secret',
      tunnelUrl: `ws://127.0.0.1:${port}/ws/firerelay`,
      reconnectDelayMs: 100,
    });

    try {
      await agent.start();
      await waitFor(() => tunnel.isConnected('agent-A'));
      expect(tunnel.connectedAgents()).toContain('agent-A');
    } finally {
      await agent.stop();
      await tunnel.close();
      await new Promise(r => server.close(r));
    }
  });

  test('handles command and returns response data', async () => {
    const { server, tunnel, port } = await createTestServer();
    const agent = new FireRelayAgent({
      nodeId: 'agent-B',
      token: 'test-secret',
      tunnelUrl: `ws://127.0.0.1:${port}/ws/firerelay`,
      reconnectDelayMs: 100,
      handlers: {
        'echo.run': async (params) => ({ echo: params }),
      },
    });

    try {
      await agent.start();
      await waitFor(() => tunnel.isConnected('agent-B'));
      await expect(
        tunnel.sendCommand('agent-B', 'echo.run', { value: 42 }),
      ).resolves.toEqual({ echo: { value: 42 } });
    } finally {
      await agent.stop();
      await tunnel.close();
      await new Promise(r => server.close(r));
    }
  });

  test('returns error when command method is unsupported', async () => {
    const { server, tunnel, port } = await createTestServer();
    const agent = new FireRelayAgent({
      nodeId: 'agent-C',
      token: 'test-secret',
      tunnelUrl: `ws://127.0.0.1:${port}/ws/firerelay`,
      reconnectDelayMs: 100,
    });

    try {
      await agent.start();
      await waitFor(() => tunnel.isConnected('agent-C'));
      await expect(
        tunnel.sendCommand('agent-C', 'routeros.notImplemented', {}),
      ).rejects.toThrow('Unsupported command method');
    } finally {
      await agent.stop();
      await tunnel.close();
      await new Promise(r => server.close(r));
    }
  });

  test('reconnects automatically after disconnect', async () => {
    const { server, tunnel, port } = await createTestServer();
    const agent = new FireRelayAgent({
      nodeId: 'agent-D',
      token: 'test-secret',
      tunnelUrl: `ws://127.0.0.1:${port}/ws/firerelay`,
      reconnectDelayMs: 100,
    });

    try {
      await agent.start();
      await waitFor(() => tunnel.isConnected('agent-D'));

      const firstSocket = tunnel._agents.get('agent-D');
      firstSocket.terminate();

      await waitFor(() => {
        const socket = tunnel._agents.get('agent-D');
        return !!socket && socket !== firstSocket && tunnel.isConnected('agent-D');
      });
    } finally {
      await agent.stop();
      await tunnel.close();
      await new Promise(r => server.close(r));
    }
  });

  test('setHandler validates method name and handler function', () => {
    const agent = new FireRelayAgent({
      nodeId: 'agent-E',
      token: 'test-secret',
      tunnelUrl: 'ws://127.0.0.1:1234/ws/firerelay',
    });

    expect(() => agent.setHandler('', async () => {})).toThrow('method must be a non-empty string');
    expect(() => agent.setHandler(123, async () => {})).toThrow('method must be a non-empty string');
    expect(() => agent.setHandler('echo.run', 'not-a-function')).toThrow('handler must be a function');

    const fn = async () => ({ ok: true });
    agent.setHandler('echo.run', fn);
    expect(agent.handlers['echo.run']).toBe(fn);
  });
});
