'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue([[]]),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const TEST_SECRET = 'coexistence-jwt-secret';
jest.mock('../src/config', () => ({
  env: 'test',
  port: 3000,
  appUrl: 'http://localhost:3000',
  jwt: { secret: TEST_SECRET, algorithm: 'HS256' },
  log: { level: 'silent' },
}));

jest.mock('../src/config/firerelay', () => ({
  tunnelSecret: 'relay-secret',
  tunnelAuthTimeout: 2000,
  tunnelCommandTimeout: 2000,
  tunnelPingInterval: 60000,
}));

const http = require('node:http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { TunnelServer, FIRERELAY_WS_PATH } = require('../src/services/firerelayTunnel');
const { WsHub, BROWSER_WS_PATH } = require('../src/services/wsHub');

function open(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function message(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000);
    const onMessage = (raw) => {
      const parsed = JSON.parse(raw.toString());
      if (parsed.type !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(parsed);
    };
    ws.on('message', onMessage);
  });
}

function expectUpgradeRejected(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Unknown WebSocket upgrade was left open'));
    }, 2000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error('Unknown WebSocket upgrade unexpectedly opened'));
    });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      expect(res.statusCode).toBe(404);
      res.resume();
      resolve();
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('FireRelay agent and browser WebSockets coexist', () => {
  it('routes both exact paths on the same HTTP server without either rejecting the other', async () => {
    const server = http.createServer();
    const tunnel = new TunnelServer();
    const hub = new WsHub();
    // Production attaches in this order.
    tunnel.attach(server);
    hub.attach(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const agent = await open(`ws://127.0.0.1:${port}${FIRERELAY_WS_PATH}`);
    const agentAuth = message(agent, 'auth_ok');
    agent.send(JSON.stringify({ type: 'auth', node_id: 'coexistence-node', token: 'relay-secret' }));
    await agentAuth;

    const browser = await open(`ws://127.0.0.1:${port}${BROWSER_WS_PATH}`);
    const browserAuth = message(browser, 'auth_ok');
    browser.send(JSON.stringify({
      type: 'auth',
      token: jwt.sign(
        { sub: 1, orgId: 5 },
        TEST_SECRET,
        { algorithm: 'HS256', expiresIn: '1h' },
      ),
    }));
    await browserAuth;

    expect(tunnel.isConnected('coexistence-node')).toBe(true);
    await expectUpgradeRejected(`ws://127.0.0.1:${port}/ws/firerelay/unknown`);

    await hub.close();
    await tunnel.close();
    await new Promise(resolve => server.close(resolve));
  });
});
