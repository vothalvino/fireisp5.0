// =============================================================================
// FireISP 5.0 — Client Group routes: members management + shared billing
// =============================================================================
// Route-level wiring + RBAC for the new endpoints:
//   POST   /client-groups/:id/members          (bulk add, clients.update)
//   DELETE /client-groups/:id/members/:clientId (remove, clients.update)
//   GET    /client-groups/:id/billing          (payments.view)
//   POST   /client-groups/:id/pay              (payments.create)
// The billing service itself is unit-tested in groupBillingService.test.js;
// here it is mocked so we test the route contract, not the money math twice.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, email: 'a@t.com', role: 'admin' }; req.userId = 1; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/models/ClientGroup', () => ({
  findByIdOrFail: jest.fn(async () => ({ id: 7, name: 'G', billing_mode: 'shared', primary_client_id: 1 })),
  getMembers: jest.fn(async () => [{ id: 1, name: 'Ana' }, { id: 2, name: 'Beto' }]),
  addMembers: jest.fn(async () => 2),
  removeMember: jest.fn(async () => true),
}));

const mockGetBilling = jest.fn();
const mockPayGroup = jest.fn();
jest.mock('../src/services/groupBillingService', () => ({
  getGroupBilling: (...a) => mockGetBilling(...a),
  payGroup: (...a) => mockPayGroup(...a),
}));

const request = require('supertest');
const app = require('../src/app');
const ClientGroup = require('../src/models/ClientGroup');

beforeEach(() => jest.clearAllMocks());

describe('POST /client-groups/:id/members', () => {
  it('adds clients in bulk and returns the refreshed member list', async () => {
    const res = await request(app).post('/api/v1/client-groups/7/members').send({ client_ids: [2, 3] });
    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(2);
    expect(ClientGroup.addMembers).toHaveBeenCalledWith('7', [2, 3], 1);
    expect(res.body.data.members).toHaveLength(2);
  });

  it('422s an empty/absent client_ids', async () => {
    const res = await request(app).post('/api/v1/client-groups/7/members').send({});
    expect(res.status).toBe(422);
    expect(ClientGroup.addMembers).not.toHaveBeenCalled();
  });
});

describe('DELETE /client-groups/:id/members/:clientId', () => {
  it('removes a member', async () => {
    const res = await request(app).delete('/api/v1/client-groups/7/members/2');
    expect(res.status).toBe(200);
    expect(ClientGroup.removeMember).toHaveBeenCalledWith('7', '2', 1);
  });

  it('404s when the client is not a member of the group', async () => {
    ClientGroup.removeMember.mockResolvedValueOnce(false);
    const res = await request(app).delete('/api/v1/client-groups/7/members/99');
    expect(res.status).toBe(404);
  });
});

describe('GET /client-groups/:id/billing', () => {
  it('returns the group billing payload from the service', async () => {
    mockGetBilling.mockResolvedValue({ group_balance: 180, members: [], open_invoices: [] });
    const res = await request(app).get('/api/v1/client-groups/7/billing');
    expect(res.status).toBe(200);
    expect(res.body.data.group_balance).toBe(180);
    expect(mockGetBilling).toHaveBeenCalledWith(1, '7');
  });

  it('propagates the service 422 for a non-shared group', async () => {
    const { ValidationError } = require('../src/utils/errors');
    mockGetBilling.mockRejectedValue(new ValidationError('not shared'));
    const res = await request(app).get('/api/v1/client-groups/7/billing');
    expect(res.status).toBe(422);
  });
});

describe('POST /client-groups/:id/pay', () => {
  it('pays the group and returns 201 with the settlement', async () => {
    mockPayGroup.mockResolvedValue({ payment: { id: 900, amount: 180 }, allocated_total: 180, settled_invoices: [{}, {}] });
    const res = await request(app).post('/api/v1/client-groups/7/pay').send({ amount: 180, payment_method: 'cash' });
    expect(res.status).toBe(201);
    expect(res.body.data.payment.id).toBe(900);
    expect(mockPayGroup).toHaveBeenCalledWith(1, '7', expect.objectContaining({ amount: 180, payment_method: 'cash', actorUserId: 1 }));
  });

  it('rejects an invalid payment_method via the schema', async () => {
    const res = await request(app).post('/api/v1/client-groups/7/pay').send({ payment_method: 'crypto' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(mockPayGroup).not.toHaveBeenCalled();
  });
});
