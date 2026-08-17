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
  url: 'https://8.8.8.8/hook',
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
    expect(res.body.data[0]).toMatchObject({
      url_configured: true,
      target_display_code: 'configured_https_endpoint',
    });
    expect(res.body.data[0]).not.toHaveProperty('url');
    expect(JSON.stringify(res.body)).not.toMatch(/8\.8\.8\.8|\/hook/);
    expect(res.headers['cache-control']).toMatch(/private.*no-store/);
  });

  test('GET list ignores hidden URL, secret and tenant filters and hidden sort fields', async () => {
    Webhook.findAll.mockResolvedValue([rawWebhookRow]);
    Webhook.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/webhooks')
      .query({
        events: 'invoice.created',
        url: 'https://8.8.8.8/hook?token=FILTER_ORACLE_SECRET',
        secret_encrypted: 'PLAINTEXT_HMAC_SECRET',
        organization_id: '999',
        order_by: 'url',
        order: 'DESC',
      })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(
      /FILTER_ORACLE_SECRET|PLAINTEXT_HMAC_SECRET|8\.8\.8\.8|\/hook/,
    );
    expect(Webhook.findAll).toHaveBeenCalledWith({
      where: { events: 'invoice.created' },
      orderBy: 'id',
      order: 'DESC',
      limit: 50,
      offset: 0,
      orgId: 1,
      withDeleted: false,
      onlyDeleted: false,
    });
    expect(Webhook.count).toHaveBeenCalledWith({
      where: { events: 'invoice.created' },
      orgId: 1,
      withDeleted: false,
      onlyDeleted: false,
    });
    const serializedModelCalls = JSON.stringify({
      list: Webhook.findAll.mock.calls,
      count: Webhook.count.mock.calls,
    });
    expect(serializedModelCalls).not.toMatch(
      /FILTER_ORACLE_SECRET|PLAINTEXT_HMAC_SECRET|organization_id|999|"url"/,
    );
  });

  test('GET /api/v1/webhooks/:id never leaks the HMAC signing secret', async () => {
    Webhook.findByIdOrFail.mockResolvedValue(rawWebhookRow);

    const res = await request(app)
      .get('/api/v1/webhooks/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    assertRedacted(res.body.data);
    expect(res.body.data).not.toHaveProperty('url');
    expect(res.body.data).toMatchObject({ target_display_code: 'configured_https_endpoint' });
    expect(JSON.stringify(res.body)).not.toContain('8.8.8.8');
  });

  test('has_secret is false when no secret is configured', async () => {
    Webhook.findByIdOrFail.mockResolvedValue({ ...rawWebhookRow, secret_encrypted: null });

    const res = await request(app)
      .get('/api/v1/webhooks/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.body.data.has_secret).toBe(false);
  });

  test('full webhook URL is confined to the update-only no-store configuration route', async () => {
    Webhook.findByIdOrFail.mockResolvedValue(rawWebhookRow);

    const res = await request(app)
      .get('/api/v1/webhooks/7/configuration')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 7, url: 'https://8.8.8.8/hook' } });
    expect(res.headers['cache-control']).toMatch(/private.*no-store/);
    expect(res.headers.pragma).toBe('no-cache');
    expect(Webhook.findByIdOrFail).toHaveBeenCalledWith('7', 1);
  });

  test('a view-only webhook user cannot fetch the full destination configuration', async () => {
    const viewOnlyToken = makeToken({ sub: 2, role: 'technician' });
    User.findById.mockResolvedValueOnce({
      id: 2,
      email: 'viewer@test.com',
      status: 'active',
      role: 'technician',
      organization_id: 1,
    });
    User.getPermissions.mockResolvedValueOnce(['webhooks.view']);

    const res = await request(app)
      .get('/api/v1/webhooks/7/configuration')
      .set('Authorization', `Bearer ${viewOnlyToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(403);
    expect(Webhook.findByIdOrFail).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toMatch(/8\.8\.8\.8|\/hook/);
  });

  test('POST /api/v1/webhooks never leaks the secret in the 201 response, but the model was called with it', async () => {
    Webhook.create.mockResolvedValue(rawWebhookRow);

    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        url: 'https://8.8.8.8/hook',
        events: 'invoice.created',
        secret: 'PLAINTEXT_HMAC_SECRET',
      });

    expect(res.status).toBe(201);
    assertRedacted(res.body.data);
    const auditInsert = require('../src/config/database').query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /INSERT INTO audit_logs/.test(sql),
    );
    expect(auditInsert).toBeDefined();
    expect(JSON.stringify(auditInsert[1])).not.toMatch(/8\.8\.8\.8|PLAINTEXT_HMAC_SECRET/);
  });

  test.each([
    'http://8.8.8.8/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.8/hook',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/hook',
    'https://user:secret@8.8.8.8/hook',
    'https://8.8.8.8/hook#fragment',
  ])('POST rejects unsafe saved-webhook destination %s before persistence', async (url) => {
    const res = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ url, events: 'invoice.created' });

    expect(res.status).toBe(422);
    expect(Webhook.create).not.toHaveBeenCalled();
  });

  test('PUT revalidates a changed saved-webhook destination before persistence', async () => {
    Webhook.findByIdOrFail.mockResolvedValue(rawWebhookRow);

    const res = await request(app)
      .put('/api/v1/webhooks/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ url: 'https://192.168.1.10/hook' });

    expect(res.status).toBe(422);
    expect(Webhook.update).not.toHaveBeenCalled();
  });

  test('restore revalidates a legacy saved-webhook destination before activation', async () => {
    const db = require('../src/config/database');
    db.query.mockResolvedValueOnce([[
      {
        id: 7,
        organization_id: 1,
        url: 'http://169.254.169.254/latest/meta-data/',
      },
    ]]);

    const res = await request(app)
      .post('/api/v1/webhooks/7/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(422);
    expect(Webhook.restore).not.toHaveBeenCalled();
  });
});
