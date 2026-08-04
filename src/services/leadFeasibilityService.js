// =============================================================================
// FireISP 5.0 — Lead feasibility (desk check) — subscriber-flow Step 1
// =============================================================================
// Answers "can we serve this address?" from data the platform already has:
//
//   * coverage zones   — point-in-polygon against coverage_zones.boundary
//                        (SRID 4326; drawn from GeoJSON in the coverage editor)
//   * fixed wireless   — nearest AP sectors (ap_sector_configs joined to their
//                        device's topology-map pin) by haversine distance
//   * FTTH             — nearest active ODF frames via their site's pin, with
//                        an HONEST free-port figure: odf_ports rows are only
//                        counted where they exist; a frame whose ports were
//                        never registered reports ports_tracked = 0 rather
//                        than pretending port_count ports are free
//
// What this deliberately is NOT: an RF terrain/Fresnel engine. Line-of-sight
// desk checks stay in dedicated tools (LINKPlanner et al.); this narrows the
// candidate list so those tools are pointed at the right tower.
// =============================================================================

const db = require('../config/database');
const Lead = require('../models/Lead');
const { NotFoundError } = require('../utils/errors');

/** Great-circle distance expression (km) for decimal lat/long columns. */
const HAVERSINE = (latCol, lngCol) => `
  (6371 * ACOS(LEAST(1, GREATEST(-1,
    COS(RADIANS(?)) * COS(RADIANS(${latCol})) * COS(RADIANS(${lngCol}) - RADIANS(?))
    + SIN(RADIANS(?)) * SIN(RADIANS(${latCol}))
  ))))`;

const NEAR_LIMIT = 3;

async function assess(leadId, orgId) {
  const lead = await Lead.findById(leadId, orgId);
  if (!lead) throw new NotFoundError('Lead');

  const lat = lead.latitude !== null && lead.latitude !== undefined ? Number(lead.latitude) : null;
  const lng = lead.longitude !== null && lead.longitude !== undefined ? Number(lead.longitude) : null;
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { has_coordinates: false, coverage_zones: [], wireless: [], ftth: [] };
  }

  // ---- Coverage zones (point-in-polygon) ----------------------------------
  // WKT for SRID 4326 is latitude-first; the explicit axis-order option pins
  // that down rather than trusting the server default.
  const point = `POINT(${lat} ${lng})`;
  let zones;
  try {
    const zoneParams = [point];
    let zoneOrg = '';
    if (orgId !== null && orgId !== undefined) {
      zoneOrg = 'AND organization_id = ?';
      zoneParams.push(orgId);
    }
    const [zoneRows] = await db.query(
      `SELECT id, name, zone_type, status, max_download_mbps, max_upload_mbps
       FROM coverage_zones
       WHERE deleted_at IS NULL
         AND ST_Contains(boundary, ST_GeomFromText(?, 4326, 'axis-order=lat-long'))
         ${zoneOrg}`,
      zoneParams,
    );
    zones = zoneRows;
  } catch (err) {
    // A malformed polygon in one zone must not kill the whole desk check —
    // report the zones as unavailable and let the distance sections stand.
    zones = [{ error: 'coverage zone lookup failed', detail: err.message }];
  }

  // ---- Fixed wireless: nearest AP sectors ---------------------------------
  const wirelessParams = [lat, lng, lat];
  let wirelessOrg = '';
  if (orgId !== null && orgId !== undefined) {
    wirelessOrg = 'AND d.organization_id = ?';
    wirelessParams.push(orgId);
  }
  const [wireless] = await db.query(
    `SELECT d.id AS device_id, d.name AS ap_name, d.latitude, d.longitude,
            s.sector_azimuth_deg, s.sector_width_deg, s.frequency_mhz,
            s.signal_min_dbm, s.link_capacity_min_mbps,
            ${HAVERSINE('d.latitude', 'd.longitude')} AS distance_km
     FROM ap_sector_configs s
     JOIN devices d ON d.id = s.device_id
     WHERE d.deleted_at IS NULL
       AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
       ${wirelessOrg}
     ORDER BY distance_km ASC
     LIMIT ${NEAR_LIMIT}`,
    wirelessParams,
  );

  // ---- FTTH: nearest active ODF frames ------------------------------------
  const ftthParams = [lat, lng, lat];
  let ftthOrg = '';
  if (orgId !== null && orgId !== undefined) {
    ftthOrg = 'AND f.organization_id = ?';
    ftthParams.push(orgId);
  }
  const [ftth] = await db.query(
    `SELECT f.id, f.name, f.port_count, st.name AS site_name,
            st.latitude, st.longitude,
            (SELECT COUNT(*) FROM odf_ports p WHERE p.odf_frame_id = f.id) AS ports_tracked,
            (SELECT COUNT(*) FROM odf_ports p WHERE p.odf_frame_id = f.id AND p.port_status = 'empty') AS free_ports,
            ${HAVERSINE('st.latitude', 'st.longitude')} AS distance_km
     FROM odf_frames f
     JOIN sites st ON st.id = f.site_id
     WHERE f.deleted_at IS NULL AND f.status = 'active'
       AND st.latitude IS NOT NULL AND st.longitude IS NOT NULL
       ${ftthOrg}
     ORDER BY distance_km ASC
     LIMIT ${NEAR_LIMIT}`,
    ftthParams,
  );

  return {
    has_coordinates: true,
    latitude: lat,
    longitude: lng,
    coverage_zones: zones,
    wireless,
    ftth,
  };
}

module.exports = { assess };
