// =============================================================================
// FireISP 5.0 — GraphQL authorization helper
// =============================================================================
// Shared RBAC guard for GraphQL, mirroring the REST requirePermission layer:
// enforceTokenScopes (so a scope-limited API token is bound) → legacy-admin
// bypass → org-scoped permission lookup. Used by index.js to gate root
// queries/mutations and by resolvers.js to gate subscriptions. Kept in its own
// module so resolvers.js can require it without a cycle through index.js.
// =============================================================================

const { GraphQLError } = require('graphql');
const { enforceTokenScopes } = require('../middleware/rbac');
const User = require('../models/User');

function gqlForbidden(message) {
  return new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });
}

async function assertGraphqlPermission(ctx, perms) {
  const user = ctx && ctx.user;
  if (!user || !user.organizationId) {
    throw gqlForbidden('Not authorized');
  }
  // API-token scope enforcement runs first (no-op for JWT users / unrestricted
  // tokens), exactly like the REST layer where it precedes the admin bypass.
  if (typeof enforceTokenScopes === 'function') {
    try {
      enforceTokenScopes(user, perms);
    } catch (err) {
      throw gqlForbidden(err.message || 'API token scope insufficient');
    }
  }
  // Legacy global admin bypasses the per-permission check, exactly like REST.
  if (user.role === 'admin') return;
  const granted = await User.getPermissions(user.id, user.organizationId);
  if (!perms.some(p => granted.includes(p))) {
    throw gqlForbidden('Forbidden: requires ' + perms.join(' or '));
  }
}

module.exports = { gqlForbidden, assertGraphqlPermission };
