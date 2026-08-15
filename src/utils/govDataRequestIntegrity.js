'use strict';

const crypto = require('crypto');

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function nullableTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

/**
 * Stable consistency marker for the immutable request-as-received fields.
 * This detects accidental or out-of-band row changes; it is not a MAC or a
 * substitute for database access controls and the append-only audit trail.
 */
function governmentRequestRowHash(request) {
  const canonical = {
    organization_id: nullableInteger(request.organization_id),
    authority_name: request.authority_name,
    authority_ref: request.authority_ref,
    request_type: request.request_type,
    client_id: nullableInteger(request.client_id),
    contract_id: nullableInteger(request.contract_id),
    ip_address: request.ip_address ?? null,
    public_port: nullableInteger(request.public_port),
    protocol: request.protocol ?? null,
    observed_at: nullableTimestamp(request.observed_at),
    legal_basis: request.legal_basis,
    created_at: nullableTimestamp(request.created_at),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function governmentRequestRowHashMatches(request) {
  const stored = String(request.row_hash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(stored)) return false;
  const computed = governmentRequestRowHash(request);
  return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(computed, 'hex'));
}

module.exports = { governmentRequestRowHash, governmentRequestRowHashMatches };
