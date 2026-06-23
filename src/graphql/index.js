// =============================================================================
// FireISP 5.0 — GraphQL Server Factory (P3.3)
// =============================================================================
// Creates a graphql-yoga server and exports it as an Express middleware.
//
// The middleware MUST be preceded by `authenticate` + `orgScope` so that
// ctx.user and ctx.orgId are available to every resolver.
//
// graphql-yoga v5 ships as a @whatwg-node/server adapter.  When used directly
// as Express middleware (`router.use('/graphql', authenticate, orgScope, yoga)`)
// Express calls `yoga(req, res, next)`, which triggers the adapter's
// `requestListener` path — the only path that both processes the query AND
// writes the Fetch `Response` back to the Node `ServerResponse`.
//
// Usage (app.js):
//   const graphqlMiddleware = require('./graphql');
//   v1.use('/graphql', authenticate, orgScope, graphqlMiddleware);
// =============================================================================

const { createYoga, createSchema } = require('graphql-yoga');
const typeDefs = require('./typeDefs');
const resolvers = require('./resolvers');
const { pubsub } = require('../services/pubsub');
const { assertGraphqlPermission } = require('./authz');

// ---------------------------------------------------------------------------
// RBAC enforcement for GraphQL (parity with the REST requirePermission layer).
// The endpoint is mounted with only `authenticate` + `orgScope`, so without
// this every authenticated user — and any scope-limited API token — could read
// clients, invoices, payments, tickets and AI config, or run aiDraftReply.
// Each root field maps to the same permission slug its REST equivalent uses;
// the guard mirrors enforceTokenScopes + the legacy-admin bypass + getPermissions.
// Wrapping happens here (not in resolvers.js) so the raw resolvers stay directly
// unit-testable.
// ---------------------------------------------------------------------------
const FIELD_PERMISSIONS = {
  Query: {
    client: ['clients.view'], clients: ['clients.view'],
    contract: ['contracts.view'],
    payment: ['payments.view'],
    invoice: ['invoices.view'], invoices: ['invoices.view'],
    ticket: ['tickets.view'], tickets: ['tickets.view'],
    aiPolicy: ['ai.policy.read'], aiReplyLogs: ['ai.policy.read'],
    aiProviders: ['ai.providers.read'], aiPhrases: ['ai.phrases.read'],
  },
  Mutation: {
    aiDraftReply: ['ai.reply.draft'],
  },
};

function guardResolvers(resolverMap) {
  const guarded = { ...resolverMap };
  for (const typeName of ['Query', 'Mutation']) {
    const perms = FIELD_PERMISSIONS[typeName];
    if (!perms || !resolverMap[typeName]) continue;
    const wrappedType = { ...resolverMap[typeName] };
    for (const [field, required] of Object.entries(perms)) {
      const orig = resolverMap[typeName][field];
      if (typeof orig !== 'function') continue;
      wrappedType[field] = async (parent, args, ctx, info) => {
        await assertGraphqlPermission(ctx, required);
        return orig(parent, args, ctx, info);
      };
    }
    guarded[typeName] = wrappedType;
  }
  return guarded;
}

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers: guardResolvers(resolvers) }),

  // Build resolver context from the Express req included in the server context.
  // graphql-yoga's requestListener automatically sets { req, res } on the
  // server context, so req.user and req.orgId (set by Express middleware) are
  // available here.
  context: ({ req }) => ({
    user: req.user,
    orgId: req.orgId,
    pubsub,
  }),

  // Express handles routing — this entry-point covers all sub-paths.
  graphqlEndpoint: '*',

  // Disable the built-in logger; FireISP uses Pino.
  logging: false,
});

/**
 * Express middleware that delegates the full request/response cycle to
 * graphql-yoga.  Using `yoga.requestListener` (rather than
 * `yoga.handleNodeRequestAndResponse`) ensures the Fetch Response is actually
 * written back to the Node ServerResponse.
 */
module.exports = function graphqlMiddleware(req, res, next) {
  try {
    yoga.requestListener(req, res);
  } catch (err) {
    next(err);
  }
};
