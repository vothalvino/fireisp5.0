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

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),

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
