// =============================================================================
// FireISP 5.0 — Site Validation Schemas
// =============================================================================

const createSite = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  site_type: { type: 'string', enum: ['pop', 'data_center', 'tower', 'aggregation_node', 'other'] },
  address: { type: 'string', max: 255 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 100 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const updateSite = {
  name: { type: 'string', min: 1, max: 255 },
  site_type: { type: 'string', enum: ['pop', 'data_center', 'tower', 'aggregation_node', 'other'] },
  address: { type: 'string', max: 255 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 100 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const patchSite = Object.fromEntries(
  Object.entries(updateSite).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createSite, updateSite, patchSite };
