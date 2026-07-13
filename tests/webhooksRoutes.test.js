// =============================================================================
// FireISP 5.0 — Webhook Route Tests (src/routes/webhooks.js)
// =============================================================================
// Regression coverage for the secret-redaction fix (same vulnerability class
// as src/routes/paymentGateways.js): secret_encrypted holds the webhook's
// HMAC signing secret. Per src/models/Webhook.js it is stored AS-IS with "no
// encryption layer applied" — genuinely plaintext, not merely
// unencrypted-when-misconfigured like other *_encrypted columns.
// GET/POST/PUT must never return it verbatim.
//
// Named webhooksRoutes.test.js (not webhooks.test.js) to avoid colliding with
// the existing service-level test file naming in this directory
// (webhookService.test.js / webhookRetry.test.js).
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/Webhook');
jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const Webhook = require('../src/models/Webhook');
const User = require('../src/models/User');
const app = require('../src/app');

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const adminToken = makeToken();

function mockAdminUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'admin@test.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

const rawWebhookRow = {
  id: 7,
  organization_id: 1,
  url: 'https://example.com/hook',
  secret_encrypted: 'PLAINTEXT_HMAC_SECRET',
  events: ['invoice.created'],
  max_retries: 5,
  timeout_seconds: 10,
  is_active: 1,
};

function assertRedacted(body) {
  expect(body).not.toHaveProperty('secret_encrypted');
  expect(JSON.stringify(body)).not.toContain('PLAINTEXT');
}

describe('Webhook routes — secret redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminUser();
  });

  test('GET /api/v1/webhooks (list) never leaks the HMAC signing secret', async () => {
    Webhook.findAll.mockResolvedValue([rawWebhookRow]);
    Webhook.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    assertRedacted(res.body.data[0]);
    expect(res.body.data[0].has_secret).toBe(true);
    expect(res.body.data[0].url).toBe('https://example.com/hook');
  });

  test('GET /api/v1/webhooks/:id never leaks the HMAC signing secret', async () => {
    Webhook.findByIdOrFail.mockResolvedValue(rawWebhookRow);

    const res = await request(app)
      .get('/api/v1/webhooks/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    assertRedacted(res.body.data);
  });

  test('has_secret is false when no secret is configured', async () => {
    Webhook.findByIdOrFail.mockResolvedValue({ ...rawWebhookRow, secret_encrypted: null });

    const res = await request(app)
      .get('/api/v1/webhooks/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.body.data.has_secret).toBe(false);
  });

  test('POST /api/v1/webhooks never leaks the secret in the 201 response, but the model was called with it', async () => {
    Webhook.create.mockResolvedValue(rawWebhookRow);

    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        url: 'https://example.com/hook',
        events: 'invoice.created',
        secret: 'PLAINTEXT_HMAC_SECRET',
      });

    expect(res.status).toBe(201);
    assertRedacted(res.body.data);
  });
});
