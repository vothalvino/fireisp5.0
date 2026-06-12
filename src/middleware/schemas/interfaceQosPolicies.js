'use strict';

// =============================================================================
// FireISP 5.0 — Interface QoS Policy Validation Schemas (§10.4)
// =============================================================================

const createInterfaceQosPolicy = {
  name:             { type: 'string', required: true, min: 1, max: 100 },
  description:      { type: 'string', max: 1000 },
  device_id:        { type: 'number', min: 1 },
  interface_name:   { type: 'string', max: 100 },
  policy_type:      { type: 'string', enum: ['htb', 'cbq', 'hfsc', 'pcq', 'prio', 'sfq', 'generic'] },
  direction:        { type: 'string', enum: ['ingress', 'egress', 'both'] },
  parent_policy_id: { type: 'number', min: 1 },
  bandwidth_mbps:   { type: 'number', min: 0 },
  ceil_mbps:        { type: 'number', min: 0 },
  burst_mbps:       { type: 'number', min: 0 },
  priority:         { type: 'number', min: 1, max: 8 },
  vendor_platform:  { type: 'string', enum: ['mikrotik', 'cisco', 'juniper', 'generic'] },
  vendor_config:    { type: 'string', max: 5000 },
  status:           { type: 'string', enum: ['active', 'inactive'] },
};

const updateInterfaceQosPolicy = {
  name:             { type: 'string', min: 1, max: 100 },
  description:      { type: 'string', max: 1000 },
  device_id:        { type: 'number', min: 1 },
  interface_name:   { type: 'string', max: 100 },
  policy_type:      { type: 'string', enum: ['htb', 'cbq', 'hfsc', 'pcq', 'prio', 'sfq', 'generic'] },
  direction:        { type: 'string', enum: ['ingress', 'egress', 'both'] },
  parent_policy_id: { type: 'number', min: 1 },
  bandwidth_mbps:   { type: 'number', min: 0 },
  ceil_mbps:        { type: 'number', min: 0 },
  burst_mbps:       { type: 'number', min: 0 },
  priority:         { type: 'number', min: 1, max: 8 },
  vendor_platform:  { type: 'string', enum: ['mikrotik', 'cisco', 'juniper', 'generic'] },
  vendor_config:    { type: 'string', max: 5000 },
  status:           { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createInterfaceQosPolicy, updateInterfaceQosPolicy };
