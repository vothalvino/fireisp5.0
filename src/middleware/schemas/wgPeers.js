// =============================================================================
// FireISP 5.0 — WireGuard User Peers Validation Schemas
// =============================================================================

// POST /wg-peers — self-service peer creation.
// Only `name` is accepted from the client; all other fields (keypair, IP,
// scope) are generated server-side. min:1 rejects empty-string names.
const wgPeers_createPeer = {
  name: { type: 'string', required: true, min: 1, max: 100 },
};

// PUT /wg-peers/admin/assignments/:userId — replace a user's network scope.
// `scopes` is an array of { scope_type, scope_id } objects; deep validation
// of each element is done in the route handler since the simple validate()
// middleware does not recurse into array items.
const wgPeers_updateAssignments = {
  scopes: { type: 'array', required: true },
};

module.exports = { wgPeers_createPeer, wgPeers_updateAssignments };
