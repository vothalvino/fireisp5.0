// =============================================================================
// FireISP 5.0 — GET /clients/:id/open-invoices
// =============================================================================
// Data source for RecordPaymentModal's invoice checklist: the client's payable
// open invoices with a computed, live balance_due. Shares its query with
// POST /payments/:id/allocate-auto (src/services/paymentAllocationService.js)
// so what the checklist shows always matches what FIFO would actually apply.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

const AUTH = 'Bearer ' + jwt.sign(
  { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue({
    id: 1, email: 'admin@test.com', status: 'active', role: 'admin', organization_id: 1,
  });
});

describe('GET /clients/:id/open-invoices', () => {
  test('returns the client\'s payable invoices with a computed balance_due', async () => {
    const rows = [
      { id: 10, invoice_number: 'INV-10', status: 'issued', total: '100.00', balance_due: '40.00', client_id: 5 },
      { id: 11, invoice_number: 'INV-11', status: 'overdue', total: '200.00', balance_due: '200.00', client_id: 5 },
    ];
    db.query.mockResolvedValueOnce([rows]);

    const res = await request(app)
      .get('/api/v1/clients/5/open-invoices')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(rows);

    // Org + client scoped, restricted to the payable statuses, oldest first.
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/client_id = \?/);
    expect(sql).toMatch(/organization_id = \?/);
    expect(sql).toMatch(/ORDER BY i\.issue_date ASC, i\.id ASC/);
    expect(params).toEqual(['5', 1, 'issued', 'sent', 'overdue']);
  });

  test('returns an empty list when the client has no open invoices', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .get('/api/v1/clients/5/open-invoices')
      .set('Authorization', AUTH)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/v1/clients/5/open-invoices');
    expect(res.status).toBe(401);
  });
});
