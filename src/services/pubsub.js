// =============================================================================
// FireISP 5.0 — Shared pub/sub instance (P3.9)
// =============================================================================

const { createPubSub } = require('graphql-yoga');

const pubsub = createPubSub();

module.exports = { pubsub };
