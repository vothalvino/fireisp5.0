// =============================================================================
// FireISP 5.0 — Coverage Zone Validation Schemas
// =============================================================================

const createCoverageZone = {
  service_area_id: { type: 'number', min: 1 },
  name: { type: 'string', required: true, min: 1, max: 255 },
  zone_type: { type: 'string', enum: ['fiber', 'fixed_wireless', 'dsl', 'cable', 'satellite', 'lte', '5g', 'other'] },
  boundary: { type: 'string', max: 65000 },
  max_download_mbps: { type: 'number', min: 0 },
  max_upload_mbps: { type: 'number', min: 0 },
  status: { type: 'string', enum: ['planned', 'under_construction', 'active', 'degraded', 'retired'] },
};

const updateCoverageZone = {
  service_area_id: { type: 'number', min: 1 },
  name: { type: 'string', min: 1, max: 255 },
  zone_type: { type: 'string', enum: ['fiber', 'fixed_wireless', 'dsl', 'cable', 'satellite', 'lte', '5g', 'other'] },
  boundary: { type: 'string', max: 65000 },
  max_download_mbps: { type: 'number', min: 0 },
  max_upload_mbps: { type: 'number', min: 0 },
  status: { type: 'string', enum: ['planned', 'under_construction', 'active', 'degraded', 'retired'] },
};

module.exports = { createCoverageZone, updateCoverageZone };
