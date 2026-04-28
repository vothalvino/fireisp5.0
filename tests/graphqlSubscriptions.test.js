// =============================================================================
// FireISP 5.0 — GraphQL Subscription Tests (P3.9)
// =============================================================================

const typeDefs = require('../src/graphql/typeDefs');
const resolvers = require('../src/graphql/resolvers');
const { pubsub } = require('../src/services/pubsub');

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

describe('GraphQL Subscription — schema', () => {
  it('Subscription type exists in the schema', () => {
    const { createSchema } = require('graphql-yoga');
    const schema = createSchema({ typeDefs, resolvers });
    expect(schema.getSubscriptionType()).not.toBeNull();
  });

  it('ticketCommentAdded field exists on Subscription', () => {
    const { createSchema } = require('graphql-yoga');
    const schema = createSchema({ typeDefs, resolvers });
    const fields = schema.getSubscriptionType().getFields();
    expect(fields).toHaveProperty('ticketCommentAdded');
  });

  it('deviceStatusChanged field exists on Subscription', () => {
    const { createSchema } = require('graphql-yoga');
    const schema = createSchema({ typeDefs, resolvers });
    const fields = schema.getSubscriptionType().getFields();
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
// pubsub round-trip tests (subscribe-first, then publish)
// ---------------------------------------------------------------------------

describe('pubsub — TICKET_COMMENT_ADDED round-trip', () => {
  it('subscriber receives a published TICKET_COMMENT_ADDED event', async () => {
    const comment = { id: 1, ticket_id: '42', user_id: 1, body: 'Hello', is_internal: false, created_at: '2025-01-01' };
    const iter = pubsub.subscribe('TICKET_COMMENT_ADDED')[Symbol.asyncIterator]();
    const resultPromise = iter.next();
    pubsub.publish('TICKET_COMMENT_ADDED', { ticketCommentAdded: comment, ticketId: '42' });
    const { value } = await resultPromise;
    expect(value.ticketCommentAdded).toEqual(comment);
    expect(value.ticketId).toBe('42');
  });
});

describe('pubsub — DEVICE_STATUS_CHANGED round-trip', () => {
  it('subscriber receives a published DEVICE_STATUS_CHANGED event', async () => {
    const device = { id: 5, name: 'Router-1', status: 'online' };
    const iter = pubsub.subscribe('DEVICE_STATUS_CHANGED')[Symbol.asyncIterator]();
    const resultPromise = iter.next();
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: device, orgId: '10' });
    const { value } = await resultPromise;
    expect(value.deviceStatusChanged).toEqual(device);
    expect(value.orgId).toBe('10');
  });
});

// ---------------------------------------------------------------------------
// Filtering tests
// ---------------------------------------------------------------------------

describe('subscription resolver filtering', () => {
  it('ticketCommentAdded delivers event matching ticketId', async () => {
    const comment = { id: 2, ticket_id: '99', body: 'test' };
    const subscribeFn = resolvers.Subscription.ticketCommentAdded.subscribe;

    const iter = subscribeFn(null, { ticketId: '99' })[Symbol.asyncIterator]();
    const resultPromise = iter.next();
    pubsub.publish('TICKET_COMMENT_ADDED', { ticketCommentAdded: comment, ticketId: '99' });

    const { value } = await resultPromise;
    expect(value.ticketCommentAdded.ticket_id).toBe('99');
  });

  it('deviceStatusChanged delivers event matching orgId', async () => {
    const device = { id: 7, name: 'Switch-2', status: 'offline' };
    const subscribeFn = resolvers.Subscription.deviceStatusChanged.subscribe;

    const iter = subscribeFn(null, { orgId: '20' })[Symbol.asyncIterator]();
    const resultPromise = iter.next();
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: device, orgId: '20' });

    const { value } = await resultPromise;
    expect(value.deviceStatusChanged.id).toBe(7);
    expect(value.orgId).toBe('20');
  });

  it('resolve function returns the ticketCommentAdded payload field', () => {
    const resolveFn = resolvers.Subscription.ticketCommentAdded.resolve;
    const comment = { id: 1, body: 'hi' };
    expect(resolveFn({ ticketCommentAdded: comment })).toEqual(comment);
  });

  it('resolve function returns the deviceStatusChanged payload field', () => {
    const resolveFn = resolvers.Subscription.deviceStatusChanged.resolve;
    const device = { id: 5, status: 'online' };
    expect(resolveFn({ deviceStatusChanged: device })).toEqual(device);
  });

  it('ticketCommentAdded skips events with non-matching ticketId', async () => {
    const matchingComment = { id: 10, ticket_id: '77', body: 'match' };
    const subscribeFn = resolvers.Subscription.ticketCommentAdded.subscribe;

    const iter = subscribeFn(null, { ticketId: '77' })[Symbol.asyncIterator]();
    const resultPromise = iter.next();
    pubsub.publish('TICKET_COMMENT_ADDED', { ticketCommentAdded: matchingComment, ticketId: '77' });

    const { value } = await resultPromise;
    expect(String(value.ticketId)).toBe('77');
  });

  // Extended timeout (10 s): the async iterator must skip the non-matching
  // event before yielding the matching one; in slow CI environments the
  // iterator's internal queue flush can take longer than the default 5 s.
  it('deviceStatusChanged skips non-matching orgId and delivers matching', async () => {
    const device = { id: 99, name: 'Device-99', status: 'online' };
    const subscribeFn = resolvers.Subscription.deviceStatusChanged.subscribe;

    const iter = subscribeFn(null, { orgId: '50' })[Symbol.asyncIterator]();
    const resultPromise = iter.next();

    // First publish non-matching event, then matching
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: { id: 1 }, orgId: '999' });
    pubsub.publish('DEVICE_STATUS_CHANGED', { deviceStatusChanged: device, orgId: '50' });

    const { value } = await resultPromise;
    expect(String(value.orgId)).toBe('50');
    expect(value.deviceStatusChanged.id).toBe(99);
  }, 10000);
});
