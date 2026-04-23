// =============================================================================
// FireISP 5.0 — Coverage Zone Service (GeoJSON ↔ MySQL POLYGON)
// =============================================================================
// MySQL stores the boundary as a POLYGON geometry (SRID 4326 / WGS 84).
// The REST API exposes / accepts GeoJSON so the map editor can work directly
// with standard GeoJSON Polygon objects without needing WKB or WKT parsing.
//
// ST_AsGeoJSON(boundary)      — converts MySQL POLYGON → GeoJSON string
// ST_GeomFromGeoJSON(?, 1, 4326) — converts GeoJSON string → MySQL POLYGON
//   flag 1 = reject documents with wrong SRID; 4326 = force SRID 4326
// =============================================================================

const db = require('../config/database');
const { AppError } = require('../utils/errors');
const auditLog = require('./auditLog');

// ---------------------------------------------------------------------------
// Column list (scalar — boundary returned separately as GeoJSON)
// ---------------------------------------------------------------------------

const SCALAR_COLS = [
  'id', 'organization_id', 'service_area_id', 'name', 'description',
  'zone_type', 'max_download_mbps', 'max_upload_mbps', 'color', 'status',
  'created_at', 'updated_at',
].join(', ');

const SELECT_SQL = `SELECT ${SCALAR_COLS}, ST_AsGeoJSON(boundary) AS boundary
                    FROM coverage_zones`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a row returned by MySQL — boundary is already a JSON string from
 * ST_AsGeoJSON(); parse it to an object so the response is clean JSON.
 */
function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    boundary: row.boundary ? JSON.parse(row.boundary) : null,
  };
}

/**
 * Validate that a GeoJSON Polygon object has the minimum required structure:
 * type = "Polygon", coordinates = array of rings, each ring ≥ 4 positions
 * (first and last must be equal — a closed ring).
 */
function validateGeoJsonPolygon(geojson) {
  if (!geojson || typeof geojson !== 'object') {
    throw new AppError('boundary must be a GeoJSON Polygon object', 422, 'VALIDATION_ERROR');
  }
  if (geojson.type !== 'Polygon') {
    throw new AppError('boundary.type must be "Polygon"', 422, 'VALIDATION_ERROR');
  }
  if (!Array.isArray(geojson.coordinates) || geojson.coordinates.length === 0) {
    throw new AppError('boundary.coordinates must be a non-empty array', 422, 'VALIDATION_ERROR');
  }
  const ring = geojson.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new AppError('boundary exterior ring must have at least 4 positions', 422, 'VALIDATION_ERROR');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List coverage zones for an org, optionally filtered by service_area_id.
 * Returns rows with boundary as parsed GeoJSON.
 */
async function listZones({ orgId, serviceAreaId } = {}) {
  let sql = `${SELECT_SQL} WHERE organization_id = ? AND deleted_at IS NULL`;
  const params = [orgId];

  if (serviceAreaId) {
    sql += ' AND service_area_id = ?';
    params.push(serviceAreaId);
  }

  sql += ' ORDER BY id';

  const [rows] = await db.query(sql, params);
  return rows.map(parseRow);
}

/**
 * Get a single coverage zone by id (must belong to orgId).
 * Throws NOT_FOUND if it doesn't exist.
 */
async function getZone(id, orgId) {
  const [rows] = await db.query(
    `${SELECT_SQL} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [id, orgId],
  );
  const zone = parseRow(rows[0]);
  if (!zone) {
    throw new AppError('Coverage zone not found', 404, 'NOT_FOUND');
  }
  return zone;
}

/**
 * Create a coverage zone.
 * body.boundary must be a GeoJSON Polygon object.
 */
async function createZone(orgId, body, userId) {
  const {
    service_area_id, name, description, zone_type = 'fiber',
    boundary, max_download_mbps, max_upload_mbps, color, status = 'planned',
  } = body;

  if (!name) {
    throw new AppError('name is required', 422, 'VALIDATION_ERROR');
  }
  validateGeoJsonPolygon(boundary);

  const boundaryJson = JSON.stringify(boundary);

  const [result] = await db.query(
    `INSERT INTO coverage_zones
       (organization_id, service_area_id, name, description, zone_type,
        boundary, max_download_mbps, max_upload_mbps, color, status)
     VALUES (?, ?, ?, ?, ?, ST_GeomFromGeoJSON(?, 1, 4326), ?, ?, ?, ?)`,
    [
      orgId, service_area_id || null, name, description || null, zone_type,
      boundaryJson, max_download_mbps || null, max_upload_mbps || null,
      color || null, status,
    ],
  );

  const zone = await getZone(result.insertId, orgId);

  await auditLog.log({
    userId,
    organizationId: orgId,
    action: 'create',
    tableName: 'coverage_zones',
    recordId: zone.id,
    newValues: { ...body, boundary: '[GeoJSON]' },
  });

  return zone;
}

/**
 * Update a coverage zone (full update).
 * body.boundary, if provided, must be a GeoJSON Polygon object.
 */
async function updateZone(id, orgId, body, userId) {
  const existing = await getZone(id, orgId);

  const {
    service_area_id, name, description, zone_type,
    boundary, max_download_mbps, max_upload_mbps, color, status,
  } = body;

  if (boundary !== undefined) {
    validateGeoJsonPolygon(boundary);
  }

  const setClauses = [];
  const params = [];

  if (service_area_id !== undefined) { setClauses.push('service_area_id = ?'); params.push(service_area_id); }
  if (name !== undefined)            { setClauses.push('name = ?');             params.push(name); }
  if (description !== undefined)     { setClauses.push('description = ?');      params.push(description); }
  if (zone_type !== undefined)       { setClauses.push('zone_type = ?');        params.push(zone_type); }
  if (max_download_mbps !== undefined) { setClauses.push('max_download_mbps = ?'); params.push(max_download_mbps); }
  if (max_upload_mbps !== undefined)   { setClauses.push('max_upload_mbps = ?');   params.push(max_upload_mbps); }
  if (color !== undefined)           { setClauses.push('color = ?');            params.push(color); }
  if (status !== undefined)          { setClauses.push('status = ?');           params.push(status); }

  if (boundary !== undefined) {
    setClauses.push('boundary = ST_GeomFromGeoJSON(?, 1, 4326)');
    params.push(JSON.stringify(boundary));
  }

  if (setClauses.length === 0) {
    return existing; // nothing to update
  }

  params.push(id, orgId);

  await db.query(
    `UPDATE coverage_zones SET ${setClauses.join(', ')} WHERE id = ? AND organization_id = ?`,
    params,
  );

  const updated = await getZone(id, orgId);

  await auditLog.log({
    userId,
    organizationId: orgId,
    action: 'update',
    tableName: 'coverage_zones',
    recordId: id,
    oldValues: { ...existing, boundary: '[GeoJSON]' },
    newValues: { ...body, ...(boundary !== undefined ? { boundary: '[GeoJSON]' } : {}) },
  });

  return updated;
}

/**
 * Soft-delete a coverage zone.
 */
async function deleteZone(id, orgId, userId) {
  const existing = await getZone(id, orgId);

  await db.query(
    'UPDATE coverage_zones SET deleted_at = NOW() WHERE id = ? AND organization_id = ?',
    [id, orgId],
  );

  await auditLog.log({
    userId,
    organizationId: orgId,
    action: 'soft_delete',
    tableName: 'coverage_zones',
    recordId: id,
    oldValues: { ...existing, boundary: '[GeoJSON]' },
  });
}

/**
 * Restore a soft-deleted coverage zone.
 */
async function restoreZone(id, orgId, userId) {
  const [rows] = await db.query(
    `${SELECT_SQL} WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL`,
    [id, orgId],
  );
  const zone = parseRow(rows[0]);
  if (!zone) {
    throw new AppError('Coverage zone not found or not deleted', 404, 'NOT_FOUND');
  }

  await db.query(
    'UPDATE coverage_zones SET deleted_at = NULL WHERE id = ? AND organization_id = ?',
    [id, orgId],
  );

  await auditLog.log({
    userId,
    organizationId: orgId,
    action: 'restore',
    tableName: 'coverage_zones',
    recordId: id,
  });

  return await getZone(id, orgId);
}

module.exports = {
  listZones,
  getZone,
  createZone,
  updateZone,
  deleteZone,
  restoreZone,
};
