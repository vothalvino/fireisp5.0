// =============================================================================
// FireISP 5.0 — FireRelay Agent Script Tests
// =============================================================================

jest.mock('../src/config/firerelay', () => ({
  mode: 'worker',
  nodes: [],
  healthInterval: 30000,
  requestTimeout: 5000,
  maxRetries: 2,
  masterUrl: 'https://master.fireisp.local',
  nodeId: 'pop-1',
  autoIncrementOffset: 1,
  maxClients: 10000,
  maxDevices: 3000,
  tunnelSecret: 'test-secret',
  tunnelAuthTimeout: 10000,
  tunnelCommandTimeout: 2000,
  tunnelPingInterval: 60000,
}));

const relayConfig = require('../src/config/firerelay');
const FireRelayAgent = require('../src/services/firerelayAgent');
const { deriveTunnelUrl, buildAgent } = require('../src/scripts/firerelay-agent');

describe('firerelay-agent script helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    relayConfig.masterUrl = 'https://master.fireisp.local';
    relayConfig.nodeId = 'pop-1';
    relayConfig.tunnelSecret = 'test-secret';
  });

  test('deriveTunnelUrl prefers FIRERELAY_TUNNEL_URL when present', () => {
    process.env.FIRERELAY_TUNNEL_URL = 'wss://explicit.example/ws/firerelay';
    expect(deriveTunnelUrl()).toBe('wss://explicit.example/ws/firerelay');
  });

  test('deriveTunnelUrl converts master URL protocol and path', () => {
    delete process.env.FIRERELAY_TUNNEL_URL;
    relayConfig.masterUrl = 'https://master.example.com/api/v1';
    expect(deriveTunnelUrl()).toBe('wss://master.example.com/ws/firerelay');

    relayConfig.masterUrl = 'http://master.example.com';
    expect(deriveTunnelUrl()).toBe('ws://master.example.com/ws/firerelay');
  });

  test('deriveTunnelUrl returns empty string when master URL is missing or invalid', () => {
    delete process.env.FIRERELAY_TUNNEL_URL;
    relayConfig.masterUrl = '';
    expect(deriveTunnelUrl()).toBe('');

    relayConfig.masterUrl = 'not a valid url';
    expect(deriveTunnelUrl()).toBe('');
  });

  test('buildAgent returns configured FireRelayAgent with default reconnect delay', () => {
    delete process.env.FIRERELAY_TUNNEL_URL;
    delete process.env.FIRERELAY_AGENT_RECONNECT_MS;
    relayConfig.masterUrl = 'https://master.example.com';

    const agent = buildAgent();
    expect(agent).toBeInstanceOf(FireRelayAgent);
    expect(agent.nodeId).toBe('pop-1');
    expect(agent.token).toBe('test-secret');
    expect(agent.tunnelUrl).toBe('wss://master.example.com/ws/firerelay');
    expect(agent.reconnectDelayMs).toBe(2000);
  });

  test('buildAgent parses FIRERELAY_AGENT_RECONNECT_MS override', () => {
    delete process.env.FIRERELAY_TUNNEL_URL;
    process.env.FIRERELAY_AGENT_RECONNECT_MS = '4500';
    relayConfig.masterUrl = 'https://master.example.com';

    const agent = buildAgent();
    expect(agent.reconnectDelayMs).toBe(4500);
  });
});
