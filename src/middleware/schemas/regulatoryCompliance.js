// =============================================================================
// FireISP 5.0 — Regulatory Compliance schemas (§16)
// =============================================================================
// The consent routes ran with NO validation since migration 314 — an invalid
// purpose or channel went straight into the ENUM column and 500'd, and a
// missing client_id inserted NULL into a NOT NULL column. The enums here must
// mirror subscriber_consents exactly.

const createConsent = {
  client_id: { type: 'number', required: true, min: 1 },
  consent_version: { type: 'string', required: true, min: 1, max: 20 },
  purpose: {
    type: 'string', required: true,
    enum: ['service_delivery', 'marketing', 'analytics', 'third_party_sharing', 'lawful_retention'],
  },
  channel: {
    type: 'string', required: true,
    enum: ['web', 'app', 'paper', 'phone', 'email'],
  },
  document_hash: { type: 'string', max: 64 },
  notes: { type: 'string', max: 2000 },
};

// Same two holes the consent route had: no schema meant an invalid request_type
// went straight at the ENUM column and 500'd, and a missing client_id inserted
// NULL into a NOT NULL column.
const createDsarRequest = {
  client_id: { type: 'number', required: true, min: 1 },
  request_type: {
    type: 'string', required: true,
    enum: ['access', 'erasure', 'portability', 'rectification', 'restriction'],
  },
  notes: { type: 'string', max: 2000 },
};

// fulfill / reject both take only an optional note.
const resolveDsarRequest = {
  notes: { type: 'string', max: 2000 },
};

module.exports = { createConsent, createDsarRequest, resolveDsarRequest };
