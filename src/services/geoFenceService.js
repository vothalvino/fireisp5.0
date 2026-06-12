// =============================================================================
// FireISP 5.0 — Geofence Evaluation Service — §13.2
// =============================================================================
// Evaluates all active geofences for an organization, checking whether CPE
// devices / client endpoints are within their designated zones.
// Emits alert events via the eventBus for violations.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'geoFenceService' });

// ---------------------------------------------------------------------------
// Haversine distance (metres) between two lat/lng points
// ---------------------------------------------------------------------------

/**
 * Haversine formula — returns distance in metres.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6_371_000; // Earth radius in metres
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Point-in-polygon — Ray casting algorithm
// ---------------------------------------------------------------------------

/**
 * Test whether a point [lat, lng] lies inside a GeoJSON ring (array of [lng, lat] pairs).
 * Note: GeoJSON uses [longitude, latitude] order.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Array<[number,number]>} ring  GeoJSON polygon ring [[lng,lat],...]
 * @returns {boolean}
 */
function pointInPolygon(lat, lng, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    // Ring coords are [lng, lat]
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    // Use lng as x, lat as y for ray cast
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Evaluate a single device against a geofence
// ---------------------------------------------------------------------------

/**
 * Check whether device position is outside the geofence.
 * Returns true when a VIOLATION is detected (device outside).
 *
 * @param {object} geofence
 * @param {number} deviceLat
 * @param {number} deviceLng
 * @returns {boolean}
 */
function isViolation(geofence, deviceLat, deviceLng) {
  if (geofence.type === 'radius') {
    const dist = haversineMetres(
      Number(geofence.center_lat),
      Number(geofence.center_lng),
      deviceLat,
      deviceLng,
    );
    return dist > geofence.radius_meters;
  }

  // Polygon — boundary is a GeoJSON coordinate array (exterior ring or Polygon)
  try {
    const boundary = typeof geofence.boundary === 'string'
      ? JSON.parse(geofence.boundary)
      : geofence.boundary;

    // Accept either [[lng,lat],...] directly or a Polygon geometry object
    let ring = boundary;
    if (boundary && boundary.type === 'Polygon') ring = boundary.coordinates[0];
    if (boundary && boundary.type === 'Feature') ring = boundary.geometry.coordinates[0];

    return !pointInPolygon(deviceLat, deviceLng, ring);
  } catch (err) {
    logger.warn({ geofenceId: geofence.id, err }, 'Failed to parse geofence boundary');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate all active geofences for an organization.
 * For each geofence that has a device_id, checks that device's position.
 * For geofences without a device_id, checks all CPE devices with lat/lng.
 *
 * Violations are logged to alert_events via the eventBus (fire-and-forget).
 *
 * @param {number} orgId
 * @returns {Promise<{ checked: number, violations: object[] }>}
 */
async function evaluateAll(orgId) {
  const [geofences] = await db.query(
    `SELECT id, name, type, boundary, center_lat, center_lng, radius_meters, device_id
     FROM map_geofences
     WHERE organization_id = ? AND is_active = 1 AND deleted_at IS NULL`,
    [orgId],
  );

  if (!geofences.length) return { checked: 0, violations: [] };

  // Fetch all CPE devices with lat/lng for org-wide checks
  const [allCpes] = await db.query(
    `SELECT d.id, d.name, d.latitude, d.longitude, d.ip_address
     FROM devices d
     WHERE d.deleted_at IS NULL
       AND d.latitude IS NOT NULL
       AND d.longitude IS NOT NULL
       AND (d.organization_id = ?
         OR d.site_id IN (SELECT id FROM sites WHERE organization_id = ?))`,
    [orgId, orgId],
  );

  const cpeMap = new Map(allCpes.map(c => [c.id, c]));

  let checked = 0;
  const violations = [];

  for (const gf of geofences) {
    const devicesToCheck = gf.device_id
      ? (cpeMap.has(gf.device_id) ? [cpeMap.get(gf.device_id)] : [])
      : allCpes;

    for (const device of devicesToCheck) {
      checked++;
      const violated = isViolation(gf, Number(device.latitude), Number(device.longitude));

      if (violated) {
        const violation = {
          geofence_id: gf.id,
          geofence_name: gf.name,
          device_id: device.id,
          device_name: device.name,
          device_lat: device.latitude,
          device_lng: device.longitude,
          detected_at: new Date().toISOString(),
        };
        violations.push(violation);

        // Emit alert event — best-effort
        try {
          const eventBus = require('./wsHub');
          if (typeof eventBus.broadcast === 'function') {
            eventBus.broadcast(`org:${orgId}`, 'geofence_violation', violation);
          }
        } catch (_err) {
          // wsHub may not be running in test/task context — ignore
        }

        logger.info({ orgId, ...violation }, 'Geofence violation detected');
      }
    }
  }

  return { checked, violations };
}

module.exports = { evaluateAll, haversineMetres, pointInPolygon, isViolation };
