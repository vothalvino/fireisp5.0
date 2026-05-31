// =============================================================================
// FireISP 5.0 — M7 Billing Routes Integration Tests
// =============================================================================
// Verifies the new promotions / tax-rules / tax-rates CRUD routes are wired,
// authenticated, org-scoped, and validated.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/models/Promotion');
jest.mock('../src/models/TaxRule');
jest.mock('../src/models/TaxRate');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const User = require('../src/models/User');
const Promotion = require('../src/models/Promotion');
const TaxRule = require('../src/models/TaxRule');
const TaxRate = require('../src/models/TaxRate');
const app = require('../src/app');

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();
const authHeader = 'Bearer ' + authToken;

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue({
    id: 1, email: 'admin@example.com', status: 'active', role: 'admin', organization_id: 1,
  });
});

const resources = [
  {
    name: 'promotions',
    path: '/api/v1/promotions',
    Model: () => Promotion,
    valid: { name: 'Summer', discount_type: 'percentage', discount_value: 20 },
    invalid: { discount_value: 20 },
  },
  {
    name: 'tax-rules',
    path: '/api/v1/tax-rules',
    Model: () => TaxRule,
    valid: { name: 'IVA', rate: 0.16, tax_type: 'vat' },
    invalid: { tax_type: 'vat' },
  },
  {
    name: 'tax-rates',
    path: '/api/v1/tax-rates',
    Model: () => TaxRate,
    valid: { name: 'IVA 16%', rate: 0.16 },
    invalid: { description: 'no name or rate' },
  },
];

describe.each(resources)('M7 $name routes', ({ path, Model, valid, invalid }) => {
  test('GET requires authentication', async () => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  test('GET lists records (authenticated, org-scoped)', async () => {
    Model().findAll.mockResolvedValue([{ id: 1, ...valid }]);
    Model().count.mockResolvedValue(1);

    const res = await request(app).get(path).set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  test('POST creates a record with valid data', async () => {
    Model().create.mockResolvedValue({ id: 42, ...valid });

    const res = await request(app)
      .post(path)
      .set('Authorization', authHeader)
      .send(valid);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(42);
    // organization_id auto-injected from the authenticated org context
    expect(Model().create).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: 1 }),
    );
  });

  test('POST rejects invalid data with 422', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', authHeader)
      .send(invalid);

    expect(res.status).toBe(422);
    expect(Model().create).not.toHaveBeenCalled();
  });

  test('DELETE soft-deletes a record', async () => {
    Model().findByIdOrFail.mockResolvedValue({ id: 7, ...valid });
    Model().delete.mockResolvedValue(true);

    const res = await request(app)
      .delete(`${path}/7`)
      .set('Authorization', authHeader);

    expect([200, 204]).toContain(res.status);
  });
});
