'use strict';

jest.mock('../src/config', () => ({
  env: 'production',
  appUrl: 'https://app.example.test',
  corsOrigins: '',
}));

const config = require('../src/config');
const {
  BROWSER_WS_COOKIE,
  BROWSER_WS_PATH,
  isAllowedCookieOrigin,
  readCookie,
} = require('../src/services/browserWebSocketAuth');

const requestWithOrigin = (origin) => ({ headers: { ...(origin ? { origin } : {}) } });

describe('browser WebSocket authentication helpers', () => {
  beforeEach(() => {
    config.env = 'production';
    config.appUrl = 'https://app.example.test';
    config.corsOrigins = '';
  });

  it('keeps the ambient access cookie scoped to the exact browser hub path', () => {
    expect(BROWSER_WS_COOKIE).toBe('fireisp_ws_access');
    expect(BROWSER_WS_PATH).toBe('/ws/firerelay/browser');
  });

  it('parses only the requested cookie and safely decodes its value', () => {
    expect(readCookie('other=one; fireisp_ws_access=a%2Eb%2Ec', BROWSER_WS_COOKIE))
      .toBe('a.b.c');
    expect(readCookie('other=one', BROWSER_WS_COOKIE)).toBeNull();
    expect(readCookie('fireisp_ws_access=%E0%A4%A', BROWSER_WS_COOKIE)).toBeNull();
  });

  it('allows the exact configured production Origin', () => {
    expect(isAllowedCookieOrigin(requestWithOrigin('https://app.example.test'))).toBe(true);
  });

  it.each([
    [undefined],
    ['null'],
    ['https://evil.example.test'],
    ['http://app.example.test'],
  ])('rejects a missing, opaque, cross-origin, or scheme-mismatched Origin (%s)', (origin) => {
    expect(isAllowedCookieOrigin(requestWithOrigin(origin))).toBe(false);
  });

  it('adds CORS_ORIGINS without excluding the same-origin APP_URL', () => {
    config.corsOrigins = 'https://admin.example.test, https://ops.example.test/';

    expect(isAllowedCookieOrigin(requestWithOrigin('https://admin.example.test'))).toBe(true);
    expect(isAllowedCookieOrigin(requestWithOrigin('https://ops.example.test'))).toBe(true);
    expect(isAllowedCookieOrigin(requestWithOrigin('https://app.example.test'))).toBe(true);
  });
});
