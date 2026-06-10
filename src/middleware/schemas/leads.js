// =============================================================================
// FireISP 5.0 — Lead Validation Schemas (§1.2)
// =============================================================================

const SOURCES = ['website', 'referral', 'phone', 'walk_in', 'social', 'campaign', 'other'];
const STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

const createLead = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  email: { type: 'email' },
  phone: { type: 'string', max: 30 },
  company: { type: 'string', max: 200 },
  source: { type: 'string', enum: SOURCES },
  status: { type: 'string', enum: STATUSES },
  estimated_value: { type: 'number', min: 0 },
  currency: { type: 'string', min: 3, max: 3 },
  assigned_to: { type: 'number', min: 1 },
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  notes: { type: 'string', max: 65535 },
};

const updateLead = Object.fromEntries(
  Object.entries(createLead).map(([k, v]) => [k, { ...v, required: false }]),
);

const patchLead = updateLead;

const convertLead = {
  // Optional overrides when materialising the lead into a client record.
  client_type: { type: 'string', enum: ['personal', 'company', 'residential', 'business', 'corporate', 'government', 'wholesale'] },
};

module.exports = { createLead, updateLead, patchLead, convertLead, SOURCES, STATUSES };
