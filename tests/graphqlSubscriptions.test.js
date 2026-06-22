// =============================================================================
// FireISP 5.0 — GraphQL Subscription Tests (P3.9)
// =============================================================================
// Subscriptions are RBAC-gated (parity with the query/mutation guard): the
// subscribe() resolvers require the same permission/scope as the REST layer and
// scope strictly to the caller's organisation. See src/graphql/authz.js.
// =============================================================================

const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  query:         (...a) => mockQuery(...a),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

const typeDefs = require('../src/graphql/typeDefs');
const resolvers = require('../src/graphql/resolvers');
const { pubsub } = require('../src/services/pubsub');

// Admin ctx — assertGraphqlPermission short-circuits at the legacy-admin bypass,
// so no getPermissions lookup is needed for the happy-path delivery tests.
const ADMIN = { user: { id: 1, role: 'admin', organizationId: 1 }, orgId: 1 };
// Let an async-generator run through its pre-subscribe awaits (permission + the
// ticket org-check) and reach pubsub.subscribe() before we publish.
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------
describe('GraphQL Subscription — schema', () => {
  const { createSchema } = require('graphql-yoga');

  it('Subscription type exists in the schema', () => {
    expect(createSchema({ typeDefs, resolvers }).getSubscriptionType()).not.toBeNull();
  });

  it('ticketCommentAdded + deviceStatusChanged fields exist', () => {
    const fields = createSchema({ typeDefs, resolvers }).getSubscriptionType().getFields();
    expect(fields).toHaveProperty('ticketCommentAdded');
    expect(fields).toHaveProperty('deviceStatusChanged');
  });

  it('subscription resolvers have subscribe and resolve functions', () => {
    const { Subscription } = resolvers;
    expect(typeof Subscription.ticketCommentAdded.subscribe).toBe('function');
    expect(typeof Subscription.ticketCommentAdded.resolve).toBe('function');
    expect(typeof Subscription.deviceStatusChanged.subscribe).toBe('function');
    expect(typeof Subscription.deviceStatusChanged.resolve).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// pubsub round-trip (transport only — no resolver gating involved)
// ---------------------------------------------------------------------------
describe('pubsub round-trip', () => {
  it('delivers a published TICKET_COMMENT_ADDED event', async () => {
    const comment = { id: 1, ticket_id: '42', body: 'Hello', is_internal: false };
    const iter = pubsub.subscribe('TICKET_COMMENT_ADDED')[Symbol.asyncIterator]();
    const p = iter.next();
    pubsub.publish('TICKET_COMMENT_ADDED', { ticketCommentAdded: comment, ticketId: '42' });
    const { value } = await p;
    expect(value.ticketCommentAdded).toEqual(comment);
    expect(value.ticketId).toBe('42');
  });

  it('delivers a published DEVICE_STATUS_CHANGED event', async () => {
    const device = { id: 5, name: 'Router-1', status: 'online' };
    const iter = pubsub.subscribe('DEVICE_STATUS_CHANGED')[Symbol.asyncIterator]();
    const p = iter.next();
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: device, orgId: '10' });
    const { value } = await p;
    expect(value.deviceStatusChanged).toEqual(device);
  });
});

// ---------------------------------------------------------------------------
// RBAC-gated subscribe() resolvers
// ---------------------------------------------------------------------------
describe('subscription gating + delivery', () => {
  beforeEach(() => mockQuery.mockReset());

  it('admin receives ticketCommentAdded for an in-org ticket', async () => {
    mockQuery.mockResolvedValue([[{ id: 99 }]]); // ticket org-check passes
    const comment = { id: 2, ticket_id: '99', body: 'test' };
    const iter = resolvers.Subscription.ticketCommentAdded
      .subscribe(null, { ticketId: '99' }, ADMIN)[Symbol.asyncIterator]();
    const p = iter.next();
    await tick();
    pubsub.publish('TICKET_COMMENT_ADDED', { ticketCommentAdded: comment, ticketId: '99' });
    const { value } = await p;
    expect(value.ticketCommentAdded.ticket_id).toBe('99');
  });

  it('deviceStatusChanged scopes to ctx.orgId and ignores the client-supplied orgId arg', async () => {
    const device = { id: 7, status: 'offline' };
    const iter = resolvers.Subscription.deviceStatusChanged
      .subscribe(null, { orgId: '999' }, ADMIN)[Symbol.asyncIterator](); // arg says 999, ctx.orgId is 1
    const p = iter.next();
    await tick();
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: { id: 1 }, orgId: '999' }); // skipped
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: device, orgId: '1' });       // delivered
    const { value } = await p;
    expect(String(value.orgId)).toBe('1');
    expect(value.deviceStatusChanged.id).toBe(7);
  }, 10000);

  it('denies ticketCommentAdded without authentication', async () => {
    const gen = resolvers.Subscription.ticketCommentAdded.subscribe(null, { ticketId: '1' }, {});
    await expect(gen.next()).rejects.toThrow(/Not authorized/);
  });

  it('denies ticketCommentAdded for a non-admin lacking tickets.view', async () => {
    mockQuery.mockResolvedValue([[]]); // User.getPermissions -> []
    const ctx = { user: { id: 2, role: 'support', organizationId: 1 }, orgId: 1 };
    const gen = resolvers.Subscription.ticketCommentAdded.subscribe(null, { ticketId: '1' }, ctx);
    await expect(gen.next()).rejects.toThrow(/Forbidden|tickets\.view/);
  });

  it('denies ticketCommentAdded when the ticket is not in the caller org', async () => {
    mockQuery.mockResolvedValue([[]]); // ticket lookup -> no row
    const gen = resolvers.Subscription.ticketCommentAdded.subscribe(null, { ticketId: '999' }, ADMIN);
    await expect(gen.next()).rejects.toThrow(/Ticket not found/);
  });

  it('denies deviceStatusChanged without authentication', async () => {
    const gen = resolvers.Subscription.deviceStatusChanged.subscribe(null, { orgId: '1' }, {});
    await expect(gen.next()).rejects.toThrow(/Not authorized/);
  });

  it('resolve() functions return the payload field', () => {
    expect(resolvers.Subscription.ticketCommentAdded.resolve({ ticketCommentAdded: { id: 1 } })).toEqual({ id: 1 });
    expect(resolvers.Subscription.deviceStatusChanged.resolve({ deviceStatusChanged: { id: 5 } })).toEqual({ id: 5 });
  });
});
