// =============================================================================
// FireISP 5.0 — Portal password-reset rate-limit isolation test
// =============================================================================
// Guards the fix from migration 385: POST /portal/auth/password-reset/request
// uses a DEDICATED portalPasswordResetLimiter instance, separate from the
// staff-side passwordResetLimiter (src/middleware/rateLimit.js). Both share
// the same rl.passwordReset budget (default 5/window) but must be counted
// independently — express-rate-limit's default in-memory store keys purely
// by IP, so if the two routes shared ONE limiter instance, an attacker
// flooding one endpoint would also lock out legitimate use of the other
// (see verifyEmailResendLimiter's precedent comment in rateLimit.js).
//
// Each test resets the module registry and re-requires `app` from scratch so
// every test starts with zeroed express-rate-limit in-memory counters —
// otherwise a request budget consumed by an earlier test in this file would
// silently change how many hits the next test needs to exhaust its budget.
// =============================================================================

function loadFreshApp() {
  jest.resetModules();
  jest.doMock('../src/config/database', () => ({
    query: jest.fn(),
    execute: jest.fn(),
    getConnection: jest.fn(),
    close: jest.fn(),
    pool: { end: jest.fn() },
  }));
  jest.doMock('../src/services/emailTransport', () => ({
    sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' }),
  }));
  const db = require('../src/config/database');
  db.query.mockResolvedValue([[]]); // every SELECT resolves "no matching user/client"
  const app = require('../src/app');
  return { app, db };
}

describe('portal password-reset rate limiting', () => {
  test('exhausting the staff /auth/password-reset/request budget does not exhaust the portal endpoint', async () => {
    const request = require('supertest');
    const { app } = loadFreshApp();

    // Exhaust the staff endpoint's tight budget (RATE_LIMIT_PASSWORD_RESET,
    // default 5).
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/auth/password-reset/request')
        .send({ email: `staff${i}@example.com` });
      expect(res.status).toBe(200);
    }
    // 6th hit on the staff endpoint is rate-limited.
    const staffBlocked = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ email: 'staff-overflow@example.com' });
    expect(staffBlocked.status).toBe(429);

    // The portal endpoint's budget is a SEPARATE express-rate-limit
    // instance/counter — it must still accept requests.
    const portalRes = await request(app)
      .post('/api/v1/portal/auth/password-reset/request')
      .send({ email: 'portal-client@example.com' });
    expect(portalRes.status).toBe(200);
  });

  test('exhausting the portal /auth/password-reset/request budget does not exhaust the staff endpoint', async () => {
    const request = require('supertest');
    const { app } = loadFreshApp();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/portal/auth/password-reset/request')
        .send({ email: `portal${i}@example.com` });
      expect(res.status).toBe(200);
    }
    const portalBlocked = await request(app)
      .post('/api/v1/portal/auth/password-reset/request')
      .send({ email: 'portal-overflow@example.com' });
    expect(portalBlocked.status).toBe(429);

    const staffRes = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ email: 'staff-client@example.com' });
    expect(staffRes.status).toBe(200);
  });
});
