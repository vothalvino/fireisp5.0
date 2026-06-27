// =============================================================================
// FireISP 5.0 — WireGuard User Peers Validation Schemas
// =============================================================================

// POST /wg-peers — self-service peer creation.
// Only `name` and the optional `full_tunnel` toggle are accepted from the client;
// all other fields (keypair, IP, scope) are generated server-side.
// full_tunnel defaults to true (new peers are full-tunnel). min:1 rejects empty names.
const wgPeers_createPeer = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  full_tunnel: { type: 'boolean' },
};

// PUT /wg-peers/admin/assignments/:userId — replace a user's network scope.
// `scopes` is an array of { scope_type, scope_id } objects; deep validation
// of each element is done in the route handler since the simple validate()
// middleware does not recurse into array items.
const wgPeers_updateAssignments = {
  scopes: { type: 'array', required: true },
};

module.exports = { wgPeers_createPeer, wgPeers_updateAssignments };
