// =============================================================================
// FireISP 5.0 — Topology Map Service — §13
// =============================================================================
// Provides data for the three map layers:
//   §13.1  Network Topology Map — device graph with link utilization
//   §13.2  Geographic Mapping   — customer pins, coverage zones, fiber routes, infra
//   §13.3  Dependency Mapping   — parent-child graph, impact analysis, cascade
// =============================================================================

const db = require('../config/database');
const _logger = require('../utils/logger').child({ service: 'topologyMapService' });

// ---------------------------------------------------------------------------
// §13.1 Network Topology Map
// ---------------------------------------------------------------------------

/**
 * Build a node+edge graph for the topology map.
 * Nodes are devices (with lat/lng for geo placement) and edges are network_links
 * enriched with utilization data from the most recent SNMP metric sample.
 *
 * @param {number} orgId
 * @param {string|null} layer  'l2' | 'l3' | 'physical' — null = all
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
async function getNetworkGraph(orgId, layer = null) {
  const [nodes] = await db.query(
    `SELECT d.id, d.name, d.type, d.role, d.status,
            d.latitude, d.longitude, d.ip_address, d.site_id,
            s.name AS site_name
     FROM devices d
     LEFT JOIN sites s ON s.id = d.site_id
     WHERE d.deleted_at IS NULL
       AND (d.organization_id = ?
         OR d.site_id IN (SELECT id FROM sites WHERE organization_id = ?))
     ORDER BY d.name`,
    [orgId, orgId],
  );

  let edgeSql = `
    SELECT nl.id, nl.device_a_id, nl.device_b_id, nl.medium, nl.role,
           nl.status, nl.capacity_mbps AS bandwidth_mbps,
           sm.if_in_octets, sm.if_out_octets
     FROM network_links nl
     LEFT JOIN (
       SELECT device_id,
              MAX(id) AS max_id,
              SUM(if_in_octets)  AS if_in_octets,
              SUM(if_out_octets) AS if_out_octets
       FROM snmp_metrics
       WHERE polled_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
       GROUP BY device_id
     ) sm ON sm.device_id = nl.device_a_id
     WHERE nl.deleted_at IS NULL
       AND nl.status != 'decommissioned'
       AND nl.organization_id = ?`;

  const params = [orgId];

  if (layer === 'l2') {
    edgeSql += " AND nl.medium IN ('ethernet','fiber','copper')";
  } else if (layer === 'l3') {
    edgeSql += " AND nl.medium IN ('vpn','mpls','gre','ip_tunnel')";
  } else if (layer === 'physical') {
    edgeSql += " AND nl.medium NOT IN ('vpn','mpls','gre','ip_tunnel')";
  }

  const [edges] = await db.query(edgeSql, params);

  // Compute utilization percentage per edge (0-100, null if no metrics)
  const enrichedEdges = edges.map(e => {
    let utilization = null;
    if (e.bandwidth_mbps && (e.if_in_octets || e.if_out_octets)) {
      const maxOctets = Math.max(e.if_in_octets || 0, e.if_out_octets || 0);
      // Rough 5-minute byte-to-bps conversion → utilization %
      const bps = (maxOctets * 8) / 300;
      const capacityBps = e.bandwidth_mbps * 1_000_000;
      utilization = Math.min(100, Math.round((bps / capacityBps) * 100));
    }
    return {
      id: e.id,
      source: e.device_a_id,
      target: e.device_b_id,
      medium: e.medium,
      role: e.role,
      status: e.status,
      bandwidth_mbps: e.bandwidth_mbps,
      utilization,
    };
  });

  return { nodes, edges: enrichedEdges };
}

// ---------------------------------------------------------------------------
// §13.2 Geographic Mapping
// ---------------------------------------------------------------------------

/**
 * Customer location pins — clients with lat/lng coordinates.
 * @param {number} orgId
 */
async function getCustomerLocations(orgId) {
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.email, c.phone,
            c.latitude, c.longitude, c.address,
            c.status,
            ct.name AS contract_plan
     FROM clients c
     LEFT JOIN contracts con ON con.client_id = c.id AND con.status = 'active' AND con.deleted_at IS NULL
     LEFT JOIN plans ct ON ct.id = con.plan_id
     WHERE c.organization_id = ?
       AND c.deleted_at IS NULL
       AND c.latitude IS NOT NULL
       AND c.longitude IS NOT NULL`,
    [orgId],
  );
  return rows;
}

/**
 * Coverage data — service areas + coverage zones as GeoJSON polygons.
 * @param {number} orgId
 */
async function getCoverageData(orgId) {
  const [serviceAreas] = await db.query(
    `SELECT id, name, coordinates, status, coverage_type
     FROM service_areas
     WHERE organization_id = ? AND deleted_at IS NULL`,
    [orgId],
  );

  const [coverageZones] = await db.query(
    `SELECT id, name, geojson, zone_type, color
     FROM coverage_zones
     WHERE organization_id = ? AND deleted_at IS NULL`,
    [orgId],
  );

  return { service_areas: serviceAreas, coverage_zones: coverageZones };
}

/**
 * Fiber routes with their route segments for polyline display.
 * @param {number} orgId
 */
async function getFiberRoutes(orgId) {
  const [routes] = await db.query(
    `SELECT fr.id, fr.name, fr.status, fr.cable_length_m AS total_length_m, fr.notes,
            fr.gis_path
     FROM fiber_routes fr
     WHERE fr.organization_id = ? AND fr.deleted_at IS NULL`,
    [orgId],
  );

  const [segments] = await db.query(
    `SELECT id, fiber_route_id, name, sequence_no, coordinates,
            length_m, cable_type, burial_type, fiber_count, status
     FROM fiber_route_segments
     WHERE organization_id = ?
     ORDER BY fiber_route_id, sequence_no`,
    [orgId],
  );

  // Group segments by route
  const segsByRoute = {};
  for (const seg of segments) {
    if (!segsByRoute[seg.fiber_route_id]) segsByRoute[seg.fiber_route_id] = [];
    segsByRoute[seg.fiber_route_id].push(seg);
  }

  return routes.map(r => ({ ...r, segments: segsByRoute[r.id] || [] }));
}

/**
 * Infrastructure pins — map_infrastructure_points + sites with lat/lng.
 * @param {number} orgId
 */
async function getInfrastructurePins(orgId) {
  const [points] = await db.query(
    `SELECT mip.id, mip.name, mip.type, mip.latitude, mip.longitude,
            mip.address, mip.description, mip.properties, mip.is_active,
            mip.site_id, s.name AS site_name
     FROM map_infrastructure_points mip
     LEFT JOIN sites s ON s.id = mip.site_id
     WHERE mip.organization_id = ?
       AND mip.deleted_at IS NULL
     ORDER BY mip.name`,
    [orgId],
  );

  // Also include sites that have lat/lng as additional pins
  const [sitePins] = await db.query(
    `SELECT id, name, 'site' AS type, latitude, longitude, address,
            NULL AS description, NULL AS properties, 1 AS is_active, NULL AS site_id
     FROM sites
     WHERE organization_id = ?
       AND deleted_at IS NULL
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL`,
    [orgId],
  );

  return { infrastructure: points, sites: sitePins };
}

// ---------------------------------------------------------------------------
// §13.3 Dependency Mapping
// ---------------------------------------------------------------------------

/**
 * Impact analysis — all devices that would be impacted if the given device fails.
 * Uses a recursive BFS traversal of device_dependency_edges.
 *
 * @param {number} orgId
 * @param {number} deviceId  The failing device
 * @returns {Promise<{ device: object, impacted: object[], edge_count: number }>}
 */
async function getImpactAnalysis(orgId, deviceId) {
  const [[device]] = await db.query(
    `SELECT id, name, type, role, status, ip_address, latitude, longitude
     FROM devices
     WHERE id = ? AND deleted_at IS NULL
       AND (organization_id = ?
         OR site_id IN (SELECT id FROM sites WHERE organization_id = ?))`,
    [deviceId, orgId, orgId],
  );

  if (!device) return { device: null, impacted: [], edge_count: 0 };

  // Load all dependency edges for the org
  const [edges] = await db.query(
    `SELECT dde.parent_device_id, dde.child_device_id, dde.dependency_type, dde.is_redundant,
            d.name AS child_name, d.type AS child_type, d.status AS child_status,
            d.ip_address AS child_ip, d.latitude AS child_lat, d.longitude AS child_lng
     FROM device_dependency_edges dde
     JOIN devices d ON d.id = dde.child_device_id AND d.deleted_at IS NULL
     WHERE dde.organization_id = ?`,
    [orgId],
  );

  // BFS from deviceId following child edges
  const visited = new Set();
  const queue = [deviceId];
  const impacted = [];

  // Build adjacency map
  const childMap = {};
  for (const e of edges) {
    if (!childMap[e.parent_device_id]) childMap[e.parent_device_id] = [];
    childMap[e.parent_device_id].push(e);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const children = childMap[current] || [];
    for (const edge of children) {
      if (!visited.has(edge.child_device_id)) {
        visited.add(edge.child_device_id);
        impacted.push({
          device_id: edge.child_device_id,
          name: edge.child_name,
          type: edge.child_type,
          status: edge.child_status,
          ip_address: edge.child_ip,
          latitude: edge.child_lat,
          longitude: edge.child_lng,
          dependency_type: edge.dependency_type,
          is_redundant: !!edge.is_redundant,
        });
        queue.push(edge.child_device_id);
      }
    }
  }

  return { device, impacted, edge_count: impacted.length };
}

/**
 * Cascade chain — upstream failure chain from a device back to root.
 * Traverses parent edges to show "who failing would cause this device to fail."
 *
 * @param {number} orgId
 * @param {number} deviceId
 */
async function getCascadeChain(orgId, deviceId) {
  const [[device]] = await db.query(
    `SELECT id, name, type, role, status, ip_address
     FROM devices
     WHERE id = ? AND deleted_at IS NULL
       AND (organization_id = ?
         OR site_id IN (SELECT id FROM sites WHERE organization_id = ?))`,
    [deviceId, orgId, orgId],
  );

  if (!device) return { device: null, chain: [] };

  const [edges] = await db.query(
    `SELECT dde.parent_device_id, dde.child_device_id, dde.dependency_type, dde.is_redundant,
            d.name AS parent_name, d.type AS parent_type, d.status AS parent_status,
            d.ip_address AS parent_ip
     FROM device_dependency_edges dde
     JOIN devices d ON d.id = dde.parent_device_id AND d.deleted_at IS NULL
     WHERE dde.organization_id = ?`,
    [orgId],
  );

  // Build reverse adjacency: child → parents
  const parentMap = {};
  for (const e of edges) {
    if (!parentMap[e.child_device_id]) parentMap[e.child_device_id] = [];
    parentMap[e.child_device_id].push(e);
  }

  // BFS upward
  const visited = new Set();
  const queue = [deviceId];
  const chain = [];

  while (queue.length > 0) {
    const current = queue.shift();
    const parents = parentMap[current] || [];
    for (const edge of parents) {
      if (!visited.has(edge.parent_device_id)) {
        visited.add(edge.parent_device_id);
        chain.push({
          device_id: edge.parent_device_id,
          name: edge.parent_name,
          type: edge.parent_type,
          status: edge.parent_status,
          ip_address: edge.parent_ip,
          dependency_type: edge.dependency_type,
          is_redundant: !!edge.is_redundant,
        });
        queue.push(edge.parent_device_id);
      }
    }
  }

  return { device, chain };
}

/**
 * Dual-homed devices — devices with 2+ upstream links or a failover_link_id.
 * @param {number} orgId
 */
async function getDualHomedDevices(orgId) {
  const [rows] = await db.query(
    `SELECT d.id, d.name, d.type, d.role, d.status, d.ip_address,
            d.latitude, d.longitude,
            COUNT(nl.id) AS upstream_link_count
     FROM devices d
     JOIN network_links nl ON (nl.device_a_id = d.id OR nl.device_b_id = d.id)
       AND nl.role IN ('uplink','backbone','transit')
       AND nl.status = 'active'
       AND nl.deleted_at IS NULL
     WHERE d.deleted_at IS NULL
       AND (d.organization_id = ?
         OR d.site_id IN (SELECT id FROM sites WHERE organization_id = ?))
     GROUP BY d.id
     HAVING upstream_link_count >= 2
     ORDER BY upstream_link_count DESC, d.name`,
    [orgId, orgId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// CRUD helpers for dependency edges
// ---------------------------------------------------------------------------

/**
 * Get dependency edges for a specific device (both parent and child edges).
 * @param {number} orgId
 * @param {number} deviceId
 */
async function getDependencyEdges(orgId, deviceId) {
  const [rows] = await db.query(
    `SELECT dde.*,
            pd.name AS parent_name, pd.type AS parent_type, pd.status AS parent_status,
            cd.name AS child_name, cd.type AS child_type, cd.status AS child_status
     FROM device_dependency_edges dde
     JOIN devices pd ON pd.id = dde.parent_device_id
     JOIN devices cd ON cd.id = dde.child_device_id
     WHERE dde.organization_id = ?
       AND (dde.parent_device_id = ? OR dde.child_device_id = ?)`,
    [orgId, deviceId, deviceId],
  );
  return rows;
}

/**
 * Create a dependency edge.
 */
async function createDependencyEdge(orgId, data) {
  const { parent_device_id, child_device_id, dependency_type = 'network', is_redundant = false, notes } = data;
  const [result] = await db.query(
    `INSERT INTO device_dependency_edges
       (organization_id, parent_device_id, child_device_id, dependency_type, is_redundant, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orgId, parent_device_id, child_device_id, dependency_type, is_redundant ? 1 : 0, notes || null],
  );
  const [[row]] = await db.query('SELECT * FROM device_dependency_edges WHERE id = ?', [result.insertId]);
  return row;
}

/**
 * Delete a dependency edge.
 */
async function deleteDependencyEdge(orgId, edgeId) {
  const [result] = await db.query(
    'DELETE FROM device_dependency_edges WHERE id = ? AND organization_id = ?',
    [edgeId, orgId],
  );
  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// CRUD helpers for geofences
// ---------------------------------------------------------------------------

async function listGeofences(orgId) {
  const [rows] = await db.query(
    `SELECT * FROM map_geofences
     WHERE organization_id = ? AND deleted_at IS NULL
     ORDER BY name`,
    [orgId],
  );
  return rows;
}

async function getGeofence(orgId, id) {
  const [[row]] = await db.query(
    `SELECT * FROM map_geofences
     WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [id, orgId],
  );
  return row;
}

async function createGeofence(orgId, data, userId) {
  const { name, type, boundary, center_lat, center_lng, radius_meters, device_id, description } = data;
  const [result] = await db.query(
    `INSERT INTO map_geofences
       (organization_id, name, type, boundary, center_lat, center_lng, radius_meters,
        device_id, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId, name, type,
      boundary ? JSON.stringify(boundary) : null,
      center_lat || null, center_lng || null, radius_meters || null,
      device_id || null, description || null, userId || null,
    ],
  );
  return getGeofence(orgId, result.insertId);
}

async function updateGeofence(orgId, id, data) {
  const fields = [];
  const params = [];
  const allowed = ['name', 'type', 'boundary', 'center_lat', 'center_lng', 'radius_meters', 'device_id', 'description', 'is_active'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key === 'boundary' && data[key] !== null ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (!fields.length) return getGeofence(orgId, id);
  params.push(id, orgId);
  await db.query(
    `UPDATE map_geofences SET ${fields.join(', ')} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    params,
  );
  return getGeofence(orgId, id);
}

async function deleteGeofence(orgId, id) {
  const [result] = await db.query(
    'UPDATE map_geofences SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [id, orgId],
  );
  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// CRUD helpers for infrastructure points
// ---------------------------------------------------------------------------

async function listInfrastructure(orgId) {
  const [rows] = await db.query(
    `SELECT mip.*, s.name AS site_name
     FROM map_infrastructure_points mip
     LEFT JOIN sites s ON s.id = mip.site_id
     WHERE mip.organization_id = ? AND mip.deleted_at IS NULL
     ORDER BY mip.name`,
    [orgId],
  );
  return rows;
}

async function getInfrastructurePoint(orgId, id) {
  const [[row]] = await db.query(
    `SELECT mip.*, s.name AS site_name
     FROM map_infrastructure_points mip
     LEFT JOIN sites s ON s.id = mip.site_id
     WHERE mip.id = ? AND mip.organization_id = ? AND mip.deleted_at IS NULL`,
    [id, orgId],
  );
  return row;
}

async function createInfrastructurePoint(orgId, data) {
  const { name, type, latitude, longitude, site_id, address, description, properties } = data;
  const [result] = await db.query(
    `INSERT INTO map_infrastructure_points
       (organization_id, site_id, name, type, latitude, longitude, address, description, properties)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId, site_id || null, name, type || 'other',
      latitude, longitude,
      address || null, description || null,
      properties ? JSON.stringify(properties) : null,
    ],
  );
  return getInfrastructurePoint(orgId, result.insertId);
}

async function updateInfrastructurePoint(orgId, id, data) {
  const fields = [];
  const params = [];
  const allowed = ['name', 'type', 'latitude', 'longitude', 'site_id', 'address', 'description', 'properties', 'is_active'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key === 'properties' && data[key] !== null ? JSON.stringify(data[key]) : data[key]);
    }
  }
  if (!fields.length) return getInfrastructurePoint(orgId, id);
  params.push(id, orgId);
  await db.query(
    `UPDATE map_infrastructure_points SET ${fields.join(', ')} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    params,
  );
  return getInfrastructurePoint(orgId, id);
}

async function deleteInfrastructurePoint(orgId, id) {
  const [result] = await db.query(
    'UPDATE map_infrastructure_points SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [id, orgId],
  );
  return result.affectedRows > 0;
}

module.exports = {
  getNetworkGraph,
  getCustomerLocations,
  getCoverageData,
  getFiberRoutes,
  getInfrastructurePins,
  getImpactAnalysis,
  getCascadeChain,
  getDualHomedDevices,
  getDependencyEdges,
  createDependencyEdge,
  deleteDependencyEdge,
  listGeofences,
  getGeofence,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  listInfrastructure,
  getInfrastructurePoint,
  createInfrastructurePoint,
  updateInfrastructurePoint,
  deleteInfrastructurePoint,
};
