// =============================================================================
// FireISP 5.0 — Payment Gateway Route Tests
// =============================================================================
// Regression coverage for the secret-redaction fix: GET (list/get), POST, and
// PUT must never return secret_key_encrypted / webhook_secret_encrypted
// verbatim — these columns hold PLAINTEXT credentials whenever
// ENCRYPTION_KEY is unset (src/utils/encryption.js's encrypt()/decrypt() are
// transparent no-ops in that case), so the default crudController identity
// serializer was leaking live secrets to anyone with payment_gateways.view.
// The route now wires a `serialize: redactPaymentGateway` option (mirrors
// src/routes/nas.js's redactNas) that strips both columns and substitutes
// has_secret_key / has_webhook_secret booleans. A write must still persist
// the real secret to the model — only the RESPONSE is redacted.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/PaymentGateway');
jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const PaymentGateway = require('../src/models/PaymentGateway');
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

// A row exactly as it would come back from `SELECT * FROM payment_gateways` —
// includes both encrypted columns populated (the leak scenario).
const rawGatewayRow = {
  id: 5,
  organization_id: 1,
  name: 'Stripe Producción',
  provider: 'stripe',
  environment: 'production',
  public_key: 'pk_live_abc123',
  secret_key_encrypted: 'sk_live_SUPER_SECRET_VALUE',
  webhook_secret_encrypted: 'whsec_SUPER_SECRET_VALUE',
  is_default: 1,
  status: 'active',
  config_json: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

// A row with no webhook secret configured (webhook_secret_encrypted is
// nullable — secret_key_encrypted is NOT NULL per database/schema.sql).
const rawGatewayNoWebhook = {
  ...rawGatewayRow,
  id: 6,
  webhook_secret_encrypted: null,
};

function assertRedacted(body) {
  expect(body).not.toHaveProperty('secret_key_encrypted');
  expect(body).not.toHaveProperty('webhook_secret_encrypted');
  expect(JSON.stringify(body)).not.toContain('SUPER_SECRET_VALUE');
}

describe('Payment Gateway routes — secret redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminUser();
  });

  describe('GET /api/v1/payment-gateways (list)', () => {
    test('response never contains the raw encrypted columns', async () => {
      PaymentGateway.findAll.mockResolvedValue([rawGatewayRow, rawGatewayNoWebhook]);
      PaymentGateway.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/v1/payment-gateways')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      res.body.data.forEach(assertRedacted);
    });

    test('substitutes has_secret_key / has_webhook_secret booleans derived from the real columns', async () => {
      PaymentGateway.findAll.mockResolvedValue([rawGatewayRow, rawGatewayNoWebhook]);
      PaymentGateway.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/v1/payment-gateways')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1');

      const [withWebhook, withoutWebhook] = res.body.data;
      expect(withWebhook.has_secret_key).toBe(true);
      expect(withWebhook.has_webhook_secret).toBe(true);
      expect(withoutWebhook.has_secret_key).toBe(true);
      expect(withoutWebhook.has_webhook_secret).toBe(false);
    });

    test('non-secret fields (name, provider, public_key, status) pass through unchanged', async () => {
      PaymentGateway.findAll.mockResolvedValue([rawGatewayRow]);
      PaymentGateway.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/v1/payment-gateways')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1');

      expect(res.body.data[0]).toMatchObject({
        id: 5,
        name: 'Stripe Producción',
        provider: 'stripe',
        public_key: 'pk_live_abc123',
        status: 'active',
      });
    });
  });

  describe('GET /api/v1/payment-gateways/:id', () => {
    test('response never contains the raw encrypted columns', async () => {
      PaymentGateway.findByIdOrFail.mockResolvedValue(rawGatewayRow);

      const res = await request(app)
        .get('/api/v1/payment-gateways/5')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1');

      expect(res.status).toBe(200);
      assertRedacted(res.body.data);
      expect(res.body.data.has_secret_key).toBe(true);
      expect(res.body.data.has_webhook_secret).toBe(true);
    });
  });

  describe('POST /api/v1/payment-gateways', () => {
    test('201 response never contains the raw encrypted columns, but the model was called with the real secret', async () => {
      PaymentGateway.create.mockResolvedValue(rawGatewayRow);

      const res = await request(app)
        .post('/api/v1/payment-gateways')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1')
        .send({
          name: 'Stripe Producción',
          provider: 'stripe',
          environment: 'production',
          secret_key_encrypted: 'sk_live_SUPER_SECRET_VALUE',
          webhook_secret_encrypted: 'whsec_SUPER_SECRET_VALUE',
        });

      expect(res.status).toBe(201);
      assertRedacted(res.body.data);
      expect(res.body.data.has_secret_key).toBe(true);

      // The write path must still persist the real secret — only the
      // response is redacted.
      expect(PaymentGateway.create).toHaveBeenCalledWith(
        expect.objectContaining({
          secret_key_encrypted: 'sk_live_SUPER_SECRET_VALUE',
          webhook_secret_encrypted: 'whsec_SUPER_SECRET_VALUE',
        }),
      );
    });
  });

  describe('PUT /api/v1/payment-gateways/:id', () => {
    test('200 response never contains the raw encrypted columns', async () => {
      PaymentGateway.findByIdOrFail.mockResolvedValue(rawGatewayRow);
      PaymentGateway.update.mockResolvedValue({ ...rawGatewayRow, name: 'Renamed' });

      const res = await request(app)
        .put('/api/v1/payment-gateways/5')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1')
        .send({ name: 'Renamed' });

      expect(res.status).toBe(200);
      assertRedacted(res.body.data);
      expect(res.body.data.name).toBe('Renamed');
    });
  });

  describe('POST /api/v1/payment-gateways/:id/restore', () => {
    test('200 response never contains the raw encrypted columns', async () => {
      PaymentGateway.restore.mockResolvedValue(rawGatewayRow);

      const res = await request(app)
        .post('/api/v1/payment-gateways/5/restore')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Org-Id', '1');

      expect(res.status).toBe(200);
      assertRedacted(res.body.data);
    });
  });
});
