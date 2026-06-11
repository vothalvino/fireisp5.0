'use strict';

// =============================================================================
// FireISP 5.0 — NAT Pool Validation Schemas
// =============================================================================

const createNatPool = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  nat_type: { type: 'string', enum: ['cgnat', '1to1', 'pat'] },
  external_ip_start: { type: 'string', required: true, max: 45 },
  external_ip_end: { type: 'string', required: true, max: 45 },
  internal_subnet: { type: 'string', max: 50 },
  port_range_start: { type: 'number', min: 1, max: 65535 },
  port_range_end: { type: 'number', min: 1, max: 65535 },
  max_ports_per_subscriber: { type: 'number', min: 1, max: 65536 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const updateNatPool = {
  name: { type: 'string', min: 1, max: 100 },
  nat_type: { type: 'string', enum: ['cgnat', '1to1', 'pat'] },
  external_ip_start: { type: 'string', max: 45 },
  external_ip_end: { type: 'string', max: 45 },
  internal_subnet: { type: 'string', max: 50 },
  port_range_start: { type: 'number', min: 1, max: 65535 },
  port_range_end: { type: 'number', min: 1, max: 65535 },
  max_ports_per_subscriber: { type: 'number', min: 1, max: 65536 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createNatPool, updateNatPool };
