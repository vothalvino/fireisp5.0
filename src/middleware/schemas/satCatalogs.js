// =============================================================================
// FireISP 5.0 — SAT Catalog Validation Schemas
// =============================================================================
// SAT catalog endpoints are read-only. The search endpoints accept an
// optional `search` query parameter.
// =============================================================================

const catalogSearch = {
  search: { type: 'string', max: 200 },
};

module.exports = { catalogSearch };
