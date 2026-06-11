'use strict';

// =============================================================================
// FireISP 5.0 — RA Guard Policy Validation Schemas
// =============================================================================

const createRaGuardPolicy = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  switch_id: { type: 'number' },
  port_pattern: { type: 'string', max: 100 },
  policy_type: { type: 'string', enum: ['strict', 'loose'] },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const updateRaGuardPolicy = {
  name: { type: 'string', min: 1, max: 100 },
  switch_id: { type: 'number' },
  port_pattern: { type: 'string', max: 100 },
  policy_type: { type: 'string', enum: ['strict', 'loose'] },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createRaGuardPolicy, updateRaGuardPolicy };
