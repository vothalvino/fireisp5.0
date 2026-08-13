'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BROWSER_WS_PATH } = require('../src/services/wsHub');
const { FIRERELAY_WS_PATH } = require('../src/services/firerelayTunnel');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function prefixLocation(config, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = config.match(new RegExp(`location\\s+${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  return match?.[1] ?? '';
}

describe('browser WebSocket transport', () => {
  it('uses a child path of the existing FireRelay upgrade tunnel', () => {
    expect(BROWSER_WS_PATH).toBe('/ws/firerelay/browser');
    expect(BROWSER_WS_PATH.startsWith(`${FIRERELAY_WS_PATH}/`)).toBe(true);
    expect(read('frontend/src/api/useWebSocket.ts'))
      .toContain("BROWSER_WS_PATH = '/ws/firerelay/browser'");
  });

  it.each([
    ['nginx/nginx.conf', 'http://app'],
    ['nginx/host-nginx.conf', 'http://fireisp_app'],
  ])('%s already upgrades the shared /ws/firerelay prefix', (file, upstream) => {
    const block = prefixLocation(read(file), '/ws/firerelay');
    expect(block).toContain(`proxy_pass              ${upstream};`);
    expect(block).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade;/);
    expect(block).toMatch(/proxy_set_header\s+Connection\s+"upgrade";/);
  });

  it('keeps the agent tunnel and browser hub on distinct server paths', () => {
    expect(FIRERELAY_WS_PATH).toBe('/ws/firerelay');
    expect(BROWSER_WS_PATH).not.toBe(FIRERELAY_WS_PATH);
    expect(read('src/services/firerelayTunnel.js')).toContain('new WebSocketServer({ noServer: true })');
    expect(read('src/services/wsHub.js')).toContain('new WebSocketServer({ noServer: true })');
    expect(read('src/services/websocketUpgradeRouter.js')).toContain("'HTTP/1.1 404 Not Found\\r\\n'");
  });

  it('the Vite development proxy forwards the shared WebSocket prefix', () => {
    expect(read('frontend/vite.config.ts'))
      .toMatch(/['"]\/ws['"]:\s*\{[\s\S]*?ws:\s*true/);
  });
});
