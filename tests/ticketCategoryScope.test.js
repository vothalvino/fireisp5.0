// =============================================================================
// FireISP 5.0 — Ticket category taxonomy + billing-category scoping tests
// =============================================================================
// Migration 394: tickets.category is a required 4-value taxonomy on create,
// and users WITHOUT the tickets.view_billing permission (e.g. technician) see
// every ticket except category='billing' — on the list, the stats, the detail
// and every /:id subresource (the router.param chokepoint).
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
jest.mock('../src/services/auditLog', () => ({ log: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const auditLog = require('../src/services/auditLog');
const app = require('../src/app');

function tokenFor(role) {
  return jwt.sign(
    { sub: 1, email: `${role}@example.com`, role, orgId: 1 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function mockAuthUser(role, permissions) {
  User.findById.mockResolvedValue({
    id: 1,
    email: `${role}@example.com`,
    status: 'active',
    role,
    organization_id: 1,
  });
  User.getPermissions.mockResolvedValue(permissions);
}

beforeEach(() => {
  jest.resetAllMocks();
  auditLog.log.mockResolvedValue();
});

// ---------------------------------------------------------------------------
// Create: category is required and constrained
// ---------------------------------------------------------------------------
describe('POST /api/tickets — category taxonomy', () => {
  test('422s without a category', async () => {
    mockAuthUser('admin', []);
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ subject: 'No category' });
    expect(res.status).toBe(422);
    expect(db.query).not.toHaveBeenCalledWith(expect.stringMatching(/^INSERT INTO `tickets`/), expect.anything());
  });

  test('422s on a value outside the taxonomy', async () => {
    mockAuthUser('admin', []);
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ subject: 'Bad category', category: 'connectivity' });
    expect(res.status).toBe(422);
  });

  test('creates with a valid category', async () => {
    mockAuthUser('admin', []);
    db.query
      .mockResolvedValueOnce([{ insertId: 7 }]) // INSERT
      .mockResolvedValueOnce([[{ id: 7, organization_id: 1, subject: 'ok', category: 'technical', description: null }]]); // findById
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ subject: 'ok', category: 'technical', client_id: 37 });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe('technical');
  });
});

// ---------------------------------------------------------------------------
// List + stats: exclusion for roles without tickets.view_billing
// ---------------------------------------------------------------------------
describe('GET /api/tickets — billing-category scoping', () => {
  test('technician (no tickets.view_billing) gets the exclusion clause', async () => {
    mockAuthUser('technician', ['tickets.view', 'ticket_relations.view']);
    db.query
      .mockResolvedValueOnce([[{ id: 1, subject: 'net down', category: 'technical' }]]) // rows
      .mockResolvedValueOnce([[{ total: 1 }]]); // count
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${tokenFor('technician')}`);
    expect(res.status).toBe(200);
    const listCall = db.query.mock.calls.find(([sql]) => /^SELECT \* FROM tickets/.test(sql));
    expect(listCall).toBeDefined();
    expect(listCall[0]).toMatch(/category <> 'billing'/);
    expect(res.body.meta).toMatchObject({ total: 1, page: 1 });
  });

  test('support (has tickets.view_billing) lists without the exclusion', async () => {
    mockAuthUser('support', ['tickets.view', 'tickets.view_billing']);
    db.query
      .mockResolvedValueOnce([[{ id: 2, subject: 'refund?', category: 'billing' }]]) // findAll
      .mockResolvedValueOnce([[{ total: 1 }]]); // count
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${tokenFor('support')}`);
    expect(res.status).toBe(200);
    const sqls = db.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqls).not.toMatch(/category <> 'billing'/);
  });

  test('stats exclude billing categories for technician', async () => {
    mockAuthUser('technician', ['tickets.view']);
    db.query.mockResolvedValueOnce([[{ status: 'open', count: 3 }]]);
    const res = await request(app)
      .get('/api/tickets/stats')
      .set('Authorization', `Bearer ${tokenFor('technician')}`);
    expect(res.status).toBe(200);
    const statsCall = db.query.mock.calls.find(([sql]) => /GROUP BY status/.test(sql));
    expect(statsCall[0]).toMatch(/category <> 'billing'/);
  });
});

// ---------------------------------------------------------------------------
// Detail + subresources: the router.param chokepoint
// ---------------------------------------------------------------------------
describe('GET /api/tickets/:id — billing tickets are 404 without the permission', () => {
  test('technician gets 404 on a billing ticket', async () => {
    mockAuthUser('technician', ['tickets.view']);
    db.query.mockResolvedValueOnce([[{ category: 'billing' }]]); // param guard lookup
    const res = await request(app)
      .get('/api/tickets/5')
      .set('Authorization', `Bearer ${tokenFor('technician')}`);
    expect(res.status).toBe(404);
  });

  test('technician gets 404 on a billing ticket subresource (comments)', async () => {
    mockAuthUser('technician', ['tickets.view']);
    db.query.mockResolvedValueOnce([[{ category: 'billing' }]]); // param guard lookup
    const res = await request(app)
      .get('/api/tickets/5/comments')
      .set('Authorization', `Bearer ${tokenFor('technician')}`);
    expect(res.status).toBe(404);
  });

  test('technician can open a non-billing ticket', async () => {
    mockAuthUser('technician', ['tickets.view']);
    db.query
      .mockResolvedValueOnce([[{ category: 'technical' }]]) // param guard lookup
      .mockResolvedValueOnce([[{ id: 5, organization_id: 1, subject: 'fiber cut', category: 'technical' }]]); // findByIdOrFail
    const res = await request(app)
      .get('/api/tickets/5')
      .set('Authorization', `Bearer ${tokenFor('technician')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.category).toBe('technical');
  });

  test('support (has tickets.view_billing) opens a billing ticket without the guard query', async () => {
    mockAuthUser('support', ['tickets.view', 'tickets.view_billing']);
    db.query.mockResolvedValueOnce([[{ id: 5, organization_id: 1, subject: 'refund?', category: 'billing' }]]); // findByIdOrFail
    const res = await request(app)
      .get('/api/tickets/5')
      .set('Authorization', `Bearer ${tokenFor('support')}`);
    expect(res.status).toBe(200);
    const guardCall = db.query.mock.calls.find(([sql]) => /^SELECT category FROM tickets/.test(sql));
    expect(guardCall).toBeUndefined();
  });

  test('403 (not 404) when the caller lacks the route permission — no category oracle', async () => {
    // A user with NO ticket permissions must get the same 403 for billing and
    // non-billing ids: the guard runs after requirePermission.
    mockAuthUser('billing', []);
    const res = await request(app)
      .get('/api/tickets/5')
      .set('Authorization', `Bearer ${tokenFor('billing')}`);
    expect(res.status).toBe(403);
    const guardCall = db.query.mock.calls.find(([sql]) => /^SELECT category FROM tickets/.test(sql));
    expect(guardCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sideways surfaces — the exclusion must hold beyond the tickets router
// ---------------------------------------------------------------------------
describe('billing-category exclusion on sideways surfaces', () => {
  test('relations of a visible ticket drop rows that touch a billing ticket', async () => {
    mockAuthUser('technician', ['tickets.view', 'ticket_relations.view']);
    db.query
      .mockResolvedValueOnce([[{ category: 'technical' }]]) // guard lookup for :id
      .mockResolvedValueOnce([[
        { id: 1, ticket_id_a: 5, ticket_id_b: 6, ticket_a_subject: 'net', ticket_b_subject: 'refund dispute', ticket_a_category: 'technical', ticket_b_category: 'billing' },
        { id: 2, ticket_id_a: 5, ticket_id_b: 7, ticket_a_subject: 'net', ticket_b_subject: 'fiber cut', ticket_a_category: 'technical', ticket_b_category: 'technical' },
      ]]);
    const res = await request(app)
      .get('/api/tickets/5/relations')
      .set('Authorization', `Bearer ${tokenFor('technician')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(2);
    expect(res.body.data[0].ticket_a_category).toBeUndefined(); // helper cols stripped
  });

  test('merge validates the body-supplied source ticket against org + category', async () => {
    mockAuthUser('admin', []);
    db.query.mockResolvedValueOnce([[]]); // source lookup: not in this org
    const res = await request(app)
      .post('/api/tickets/5/merge')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ source_ticket_id: 999 });
    expect(res.status).toBe(404);
    // comments must NOT have been moved
    const moveCall = db.query.mock.calls.find(([sql]) => /UPDATE ticket_comments SET ticket_id/.test(sql));
    expect(moveCall).toBeUndefined();
  });

  test('NOC ticket-queue excludes billing tickets for technician', async () => {
    mockAuthUser('technician', ['noc.view']);
    db.query.mockResolvedValueOnce([[{ status: 'open', count: 2 }]]);
    const res = await request(app)
      .get('/api/noc/ticket-queue')
      .set('Authorization', `Bearer ${tokenFor('technician')}`);
    expect(res.status).toBe(200);
    const call = db.query.mock.calls.find(([sql]) => /FROM tickets t/.test(sql));
    expect(call[0]).toMatch(/t\.category <> 'billing'/);
  });

  test('client activity timeline excludes billing tickets when the flag is off', async () => {
    const interactionService = require('../src/services/interactionService');
    db.queryReplica.mockResolvedValueOnce([[]]);
    await interactionService.activityTimeline(5, 1, { includeBillingTickets: false });
    expect(db.queryReplica.mock.calls[0][0]).toMatch(/t\.category <> 'billing'/);

    db.queryReplica.mockResolvedValueOnce([[]]);
    await interactionService.activityTimeline(5, 1, { includeBillingTickets: true });
    expect(db.queryReplica.mock.calls[1][0]).not.toMatch(/t\.category <> 'billing'/);
  });

  test('escalation candidates exclude billing tickets when the flag is off', async () => {
    const interactionService = require('../src/services/interactionService');
    db.queryReplica.mockResolvedValueOnce([[]]);
    await interactionService.escalationCandidates(1, { includeBillingTickets: false });
    expect(db.queryReplica.mock.calls[0][0]).toMatch(/t\.category <> 'billing'/);
  });

  test('GraphQL ticketCommentAdded subscription rejects billing tickets without the permission', async () => {
    const resolvers = require('../src/graphql/resolvers');
    User.getPermissions.mockResolvedValue(['tickets.view']); // no view_billing
    db.query.mockResolvedValueOnce([[{ id: 9, category: 'billing' }]]); // org lookup
    const ctx = { user: { id: 1, role: 'technician', organizationId: 1 }, orgId: 1 };
    const iter = resolvers.Subscription.ticketCommentAdded.subscribe(null, { ticketId: 9 }, ctx);
    await expect(iter.next()).rejects.toThrow('Ticket not found in your organization');
  });
});
