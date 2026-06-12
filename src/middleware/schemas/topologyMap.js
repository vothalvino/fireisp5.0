// =============================================================================
// FireISP 5.0 — Topology Map Validation Schemas — §13
// =============================================================================

const createGeofence = {
  name: { type: 'string', required: true, max: 255 },
  type: { type: 'string', required: true, enum: ['polygon', 'radius'] },
  boundary: { type: 'object', required: false },
  center_lat: { type: 'number', required: false, min: -90, max: 90 },
  center_lng: { type: 'number', required: false, min: -180, max: 180 },
  radius_meters: { type: 'number', required: false, min: 1 },
  device_id: { type: 'number', required: false },
  description: { type: 'string', required: false, max: 500 },
};

const updateGeofence = {
  name: { type: 'string', required: false, max: 255 },
  type: { type: 'string', required: false, enum: ['polygon', 'radius'] },
  boundary: { type: 'object', required: false },
  center_lat: { type: 'number', required: false, min: -90, max: 90 },
  center_lng: { type: 'number', required: false, min: -180, max: 180 },
  radius_meters: { type: 'number', required: false, min: 1 },
  device_id: { type: 'number', required: false },
  description: { type: 'string', required: false, max: 500 },
  is_active: { type: 'boolean', required: false },
};

const createInfrastructure = {
  name: { type: 'string', required: true, max: 255 },
  type: { type: 'string', required: false, enum: ['tower', 'cabinet', 'odf', 'splice_closure', 'pole', 'pop', 'other'] },
  latitude: { type: 'number', required: true, min: -90, max: 90 },
  longitude: { type: 'number', required: true, min: -180, max: 180 },
  site_id: { type: 'number', required: false },
  address: { type: 'string', required: false, max: 500 },
  description: { type: 'string', required: false, max: 500 },
};

const updateInfrastructure = {
  name: { type: 'string', required: false, max: 255 },
  type: { type: 'string', required: false, enum: ['tower', 'cabinet', 'odf', 'splice_closure', 'pole', 'pop', 'other'] },
  latitude: { type: 'number', required: false, min: -90, max: 90 },
  longitude: { type: 'number', required: false, min: -180, max: 180 },
  site_id: { type: 'number', required: false },
  address: { type: 'string', required: false, max: 500 },
  description: { type: 'string', required: false, max: 500 },
  is_active: { type: 'boolean', required: false },
};

const createDependencyEdge = {
  parent_device_id: { type: 'number', required: true },
  child_device_id: { type: 'number', required: true },
  dependency_type: { type: 'string', required: false, enum: ['power', 'network', 'management', 'other'] },
  is_redundant: { type: 'boolean', required: false },
  notes: { type: 'string', required: false, max: 500 },
};

module.exports = { createGeofence, updateGeofence, createInfrastructure, updateInfrastructure, createDependencyEdge };
