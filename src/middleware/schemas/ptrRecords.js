'use strict';

// =============================================================================
// FireISP 5.0 — PTR Record Validation Schemas
// =============================================================================

const createPtrRecord = {
  ip_address: { type: 'string', required: true, max: 45 },
  ip_version: { type: 'string', enum: ['ipv4', 'ipv6'] },
  hostname: { type: 'string', required: true, max: 255 },
  ttl: { type: 'number', min: 0, max: 86400 },
  zone: { type: 'string', max: 255 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const updatePtrRecord = {
  ip_address: { type: 'string', max: 45 },
  ip_version: { type: 'string', enum: ['ipv4', 'ipv6'] },
  hostname: { type: 'string', max: 255 },
  ttl: { type: 'number', min: 0, max: 86400 },
  zone: { type: 'string', max: 255 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createPtrRecord, updatePtrRecord };
