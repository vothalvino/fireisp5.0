'use strict';
// =============================================================================
// FireISP 5.0 — Security headers have exactly ONE owner
// =============================================================================
// The app sets every security header itself (Helmet, src/app.js). The reverse
// proxy must not repeat them, because nginx `add_header` APPENDS to whatever
// the upstream already sent — it does not override. Setting them in both
// places put two values on every live response:
//
//   x-xss-protection:  0, 1; mode=block          <- disabled vs re-enabled
//   referrer-policy:   no-referrer, strict-origin-when-cross-origin
//   strict-transport-security:
//        max-age=31536000; includeSubDomains, max-age=63072000; ...; preload
//
// which left the effective policy to browser list-parsing rather than to
// anything anyone chose. Confirmed against the live edge on 2026-07-26.
//
// Two halves, and the second is the load-bearing one:
//   1. the app's own values are exact and deliberate (a Helmet major bump
//      cannot quietly move them), and
//   2. no proxy config re-adds them — jest never sees nginx, so a runtime test
//      CANNOT catch a duplicate reappearing. Only this static guard can.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const app = require('../src/app');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Every header the app claims ownership of, with the value it must send.
const OWNED = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'x-xss-protection': '0',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

describe('the app sends exactly one value for each security header', () => {
  // Node joins repeated response headers with ", ", so an exact-equality
  // assertion is also a duplicate detector for anything the APP double-sets.
  it.each(Object.entries(OWNED))('%s is exactly %s', async (header, value) => {
    const res = await request(app).get('/health');
    expect(res.headers[header]).toBe(value);
  });

  it('HSTS does not declare preload', async () => {
    // preload is a one-way door: it is slow to reverse and pins every
    // subdomain to HTTPS, which can strand an operator's legacy HTTP-only
    // equipment portal. Opting in is the operator's call, not our default.
    const res = await request(app).get('/health');
    expect(res.headers['strict-transport-security']).not.toMatch(/preload/i);
  });

  it('X-Frame-Options agrees with the CSP frame-ancestors directive', async () => {
    // Two layers disagreeing about framing is the same defect class as the
    // proxy duplication: modern browsers honour the CSP and ignore XFO, so a
    // mismatch is a silent split between modern and legacy browsers.
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('the legacy XSS auditor stays disabled', async () => {
    // `0` is deliberate, not an oversight. The filter is gone from every
    // modern browser and was itself an information-leak vector; the proxy's
    // `1; mode=block` was the wrong value to be fighting over.
    const res = await request(app).get('/health');
    expect(res.headers['x-xss-protection']).toBe('0');
  });

  it('Referrer-Policy keeps the CSRF Referer fallback usable', async () => {
    // src/middleware/csrf.js falls back to the Referer header when Origin is
    // absent and 403s when BOTH are missing. Helmet's stricter `no-referrer`
    // default strips Referer on same-origin requests too, which would break
    // that fallback for cookie-session clients.
    const res = await request(app).get('/health');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(read('src/middleware/csrf.js')).toMatch(/headers\.referer/);
  });
});

describe('no proxy config re-adds an app-owned header', () => {
  const configs = [
    'nginx/nginx.conf',
    'nginx/host-nginx.conf',
    'nginx/nginx.bootstrap.conf',
    'docs/deployment.md',
  ];

  it.each(configs)('%s adds no app-owned header', (file) => {
    const body = read(file);
    const offenders = [];
    for (const [i, line] of body.split('\n').entries()) {
      const m = line.match(/^\s*add_header\s+([A-Za-z-]+)/);
      if (!m) continue;
      if (Object.hasOwn(OWNED, m[1].toLowerCase())) {
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the guard actually recognises the syntax it is guarding against', () => {
    // A regex that matched nothing would make every assertion above vacuous
    // and pass forever. Prove it fires on the exact line that was removed.
    const sample = '        add_header X-XSS-Protection          "1; mode=block"     always;';
    const m = sample.match(/^\s*add_header\s+([A-Za-z-]+)/);
    expect(m).not.toBeNull();
    expect(Object.hasOwn(OWNED, m[1].toLowerCase())).toBe(true);
  });

  it('the proxy configs still exist and are non-trivial', () => {
    // Guards against a rename turning the sweep above into a no-op.
    for (const f of configs) expect(read(f).length).toBeGreaterThan(500);
  });
});
