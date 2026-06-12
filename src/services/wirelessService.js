'use strict';

// =============================================================================
// FireISP 5.0 — Wireless/WISP Management Service (§9.1 + §9.2 + §9.3)
// =============================================================================
// Provides domain logic for:
//   • AP sector configuration management               (§9.1)
//   • Channel plan management and conflict detection   (§9.1)
//   • Wireless client session snapshots                (§9.1)
//   • Channel interference detection and recording     (§9.1)
//   • AP remote command job management                 (§9.1)
//   • Link planning calculator (haversine/FSPL/Fresnel)(§9.2)
//   • PTP link metrics retrieval                       (§9.2)
//   • Spectrum scan storage                            (§9.3)
//   • Signal distribution histogram                   (§9.3)
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'wirelessService' });

// ---------------------------------------------------------------------------
// AP Sector Configs
// ---------------------------------------------------------------------------

/**
 * List all AP sector configs for an org (with optional device filter).
 */
async function listApSectorConfigs(orgId, { deviceId, deletedAt } = {}) {
  let sql = `
    SELECT asc_cfg.*, d.hostname AS device_hostname, d.type AS device_type,
           d.ip_address AS device_ip,
           acp.name AS channel_plan_name, acp.frequency_mhz AS plan_frequency_mhz
    FROM ap_sector_configs asc_cfg
    LEFT JOIN devices d ON d.id = asc_cfg.device_id
    LEFT JOIN ap_channel_plans acp ON acp.id = asc_cfg.channel_plan_id
    WHERE (asc_cfg.organization_id = ? OR asc_cfg.organization_id IS NULL)
  `;
  const params = [orgId];

  if (deviceId) {
    sql += ' AND asc_cfg.device_id = ?';
    params.push(deviceId);
  }
  if (!deletedAt) {
    sql += ' AND asc_cfg.deleted_at IS NULL';
  }
  sql += ' ORDER BY asc_cfg.id ASC';

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get a single AP sector config by ID.
 */
async function getApSectorConfig(id, orgId) {
  const [rows] = await db.query(
    `SELECT asc_cfg.*, d.hostname AS device_hostname, d.type AS device_type,
            d.ip_address AS device_ip,
            acp.name AS channel_plan_name
     FROM ap_sector_configs asc_cfg
     LEFT JOIN devices d ON d.id = asc_cfg.device_id
     LEFT JOIN ap_channel_plans acp ON acp.id = asc_cfg.channel_plan_id
     WHERE asc_cfg.id = ?
       AND (asc_cfg.organization_id = ? OR asc_cfg.organization_id IS NULL)
       AND asc_cfg.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Create an AP sector config.
 * Validates that the device exists and is of type ptmp_ap or ptp.
 */
async function createApSectorConfig(orgId, data) {
  const { device_id } = data;

  // Validate device type
  const [devRows] = await db.query(
    `SELECT id, type FROM devices
     WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL`,
    [device_id, orgId],
  );
  if (!devRows.length) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['ptmp_ap', 'ptp', 'outdoor_cpe', 'indoor_cpe'].includes(devRows[0].type)) {
    const err = new Error('Device must be of type ptmp_ap, ptp, outdoor_cpe, or indoor_cpe');
    err.statusCode = 400;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO ap_sector_configs SET ?',
    [{ organization_id: orgId, ...fields }],
  );
  return getApSectorConfig(result.insertId, orgId);
}

/**
 * Update an AP sector config.
 */
async function updateApSectorConfig(id, orgId, data) {
  const existing = await getApSectorConfig(id, orgId);
  if (!existing) {
    const err = new Error('AP sector config not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = data;
  await db.query(
    'UPDATE ap_sector_configs SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [{ ...fields, updated_at: new Date() }, id, orgId],
  );
  return getApSectorConfig(id, orgId);
}

/**
 * Soft-delete an AP sector config.
 */
async function deleteApSectorConfig(id, orgId) {
  const existing = await getApSectorConfig(id, orgId);
  if (!existing) {
    const err = new Error('AP sector config not found');
    err.statusCode = 404;
    throw err;
  }
  await db.query(
    'UPDATE ap_sector_configs SET deleted_at = NOW() WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
}

/**
 * Restore a soft-deleted AP sector config.
 */
async function restoreApSectorConfig(id, orgId) {
  await db.query(
    'UPDATE ap_sector_configs SET deleted_at = NULL WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
  return getApSectorConfig(id, orgId);
}

// ---------------------------------------------------------------------------
// AP Channel Plans
// ---------------------------------------------------------------------------

/**
 * List all AP channel plans for an org.
 */
async function listApChannelPlans(orgId, { siteId, status } = {}) {
  let sql = `
    SELECT acp.*, s.name AS site_name
    FROM ap_channel_plans acp
    LEFT JOIN sites s ON s.id = acp.site_id
    WHERE (acp.organization_id = ? OR acp.organization_id IS NULL)
      AND acp.deleted_at IS NULL
  `;
  const params = [orgId];

  if (siteId) {
    sql += ' AND acp.site_id = ?';
    params.push(siteId);
  }
  if (status) {
    sql += ' AND acp.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY acp.site_id ASC, acp.frequency_mhz ASC';

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get a single AP channel plan by ID.
 */
async function getApChannelPlan(id, orgId) {
  const [rows] = await db.query(
    `SELECT acp.*, s.name AS site_name
     FROM ap_channel_plans acp
     LEFT JOIN sites s ON s.id = acp.site_id
     WHERE acp.id = ?
       AND (acp.organization_id = ? OR acp.organization_id IS NULL)
       AND acp.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Create an AP channel plan.
 */
async function createApChannelPlan(orgId, data) {
  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO ap_channel_plans SET ?',
    [{ organization_id: orgId, ...fields }],
  );
  return getApChannelPlan(result.insertId, orgId);
}

/**
 * Update an AP channel plan.
 */
async function updateApChannelPlan(id, orgId, data) {
  const existing = await getApChannelPlan(id, orgId);
  if (!existing) {
    const err = new Error('AP channel plan not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = data;
  await db.query(
    'UPDATE ap_channel_plans SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [{ ...fields, updated_at: new Date() }, id, orgId],
  );
  return getApChannelPlan(id, orgId);
}

/**
 * Soft-delete an AP channel plan.
 */
async function deleteApChannelPlan(id, orgId) {
  const existing = await getApChannelPlan(id, orgId);
  if (!existing) {
    const err = new Error('AP channel plan not found');
    err.statusCode = 404;
    throw err;
  }
  await db.query(
    'UPDATE ap_channel_plans SET deleted_at = NOW() WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
}

/**
 * Restore a soft-deleted AP channel plan.
 */
async function restoreApChannelPlan(id, orgId) {
  await db.query(
    'UPDATE ap_channel_plans SET deleted_at = NULL WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
  return getApChannelPlan(id, orgId);
}

/**
 * Detect potential channel conflicts within a site.
 * Returns pairs of channel plans that overlap in frequency.
 */
async function detectChannelConflicts(siteId, orgId) {
  const [rows] = await db.query(
    `SELECT a.id AS plan_a_id, a.name AS plan_a_name,
            a.frequency_mhz AS freq_a, a.channel_width_mhz AS width_a,
            b.id AS plan_b_id, b.name AS plan_b_name,
            b.frequency_mhz AS freq_b, b.channel_width_mhz AS width_b
     FROM ap_channel_plans a
     JOIN ap_channel_plans b ON b.id > a.id AND b.site_id = a.site_id
     WHERE a.site_id = ?
       AND (a.organization_id = ? OR a.organization_id IS NULL)
       AND a.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND a.status = 'active'
       AND b.status = 'active'
       AND ABS(a.frequency_mhz - b.frequency_mhz) < (a.channel_width_mhz + b.channel_width_mhz) / 2`,
    [siteId, orgId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Wireless Client Sessions
// ---------------------------------------------------------------------------

/**
 * List wireless client sessions for an AP device.
 */
async function listWirelessClientSessions(orgId, { deviceId, since, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT wcs.*, d.hostname AS ap_hostname,
           cd.hostname AS client_hostname, cd.ip_address AS client_device_ip
    FROM wireless_client_sessions wcs
    LEFT JOIN devices d ON d.id = wcs.device_id
    LEFT JOIN devices cd ON cd.id = wcs.client_device_id
    WHERE (wcs.organization_id = ? OR wcs.organization_id IS NULL)
  `;
  const params = [orgId];

  if (deviceId) {
    sql += ' AND wcs.device_id = ?';
    params.push(deviceId);
  }
  if (since) {
    sql += ' AND wcs.last_seen_at >= ?';
    params.push(since);
  }
  sql += ' ORDER BY wcs.last_seen_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Record a batch of wireless client session snapshots from an AP poll.
 * Accepts an array of session objects; each must have device_id and mac_address.
 */
async function recordClientSessions(orgId, sessions) {
  if (!sessions || !sessions.length) return 0;

  const rows = sessions.map(s => [
    orgId,
    s.device_id,
    s.client_device_id || null,
    s.mac_address,
    s.ip_address || null,
    s.signal_dbm || null,
    s.noise_floor_dbm || null,
    s.snr_db || null,
    s.ccq_pct || null,
    s.tx_rate_mbps || null,
    s.rx_rate_mbps || null,
    s.distance_m || null,
    s.connected_at || null,
    s.last_seen_at || new Date(),
  ]);

  const [result] = await db.query(
    `INSERT INTO wireless_client_sessions
       (organization_id, device_id, client_device_id, mac_address, ip_address,
        signal_dbm, noise_floor_dbm, snr_db, ccq_pct, tx_rate_mbps, rx_rate_mbps,
        distance_m, connected_at, last_seen_at)
     VALUES ?`,
    [rows],
  );
  logger.debug({ orgId, count: result.affectedRows }, 'wireless client sessions recorded');
  return result.affectedRows;
}

// ---------------------------------------------------------------------------
// Channel Interference
// ---------------------------------------------------------------------------

/**
 * List channel interference records for an org.
 */
async function listChannelInterference(orgId, { siteId, level, since, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT wci.*, s.name AS site_name,
           asc_cfg.sector_azimuth_deg, asc_cfg.frequency_mhz AS sector_frequency_mhz
    FROM wireless_channel_interference wci
    LEFT JOIN sites s ON s.id = wci.site_id
    LEFT JOIN ap_sector_configs asc_cfg ON asc_cfg.id = wci.ap_sector_config_id
    WHERE (wci.organization_id = ? OR wci.organization_id IS NULL)
      AND wci.deleted_at IS NULL
  `;
  const params = [orgId];

  if (siteId) {
    sql += ' AND wci.site_id = ?';
    params.push(siteId);
  }
  if (level) {
    sql += ' AND wci.interference_level = ?';
    params.push(level);
  }
  if (since) {
    sql += ' AND wci.detected_at >= ?';
    params.push(since);
  }
  sql += ' ORDER BY wci.detected_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Create a channel interference record.
 */
async function createChannelInterference(orgId, data) {
  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO wireless_channel_interference SET ?',
    [{ organization_id: orgId, ...fields }],
  );
  const [rows] = await db.query('SELECT * FROM wireless_channel_interference WHERE id = ?', [result.insertId]);
  return rows[0];
}

/**
 * Update a channel interference record.
 */
async function updateChannelInterference(id, orgId, data) {
  const [existing] = await db.query(
    'SELECT id FROM wireless_channel_interference WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [id, orgId],
  );
  if (!existing.length) {
    const err = new Error('Channel interference record not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = data;
  await db.query(
    'UPDATE wireless_channel_interference SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [{ ...fields, updated_at: new Date() }, id, orgId],
  );
  const [rows] = await db.query('SELECT * FROM wireless_channel_interference WHERE id = ?', [id]);
  return rows[0];
}

/**
 * Soft-delete a channel interference record.
 */
async function deleteChannelInterference(id, orgId) {
  await db.query(
    'UPDATE wireless_channel_interference SET deleted_at = NOW() WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
}

// ---------------------------------------------------------------------------
// AP Command Jobs
// ---------------------------------------------------------------------------

/**
 * List AP command jobs for an org.
 */
async function listApCommandJobs(orgId, { deviceId, status, limit = 100, offset = 0 } = {}) {
  let sql = `
    SELECT acj.*, d.hostname AS device_hostname, d.ip_address AS device_ip
    FROM ap_command_jobs acj
    LEFT JOIN devices d ON d.id = acj.device_id
    WHERE (acj.organization_id = ? OR acj.organization_id IS NULL)
      AND acj.deleted_at IS NULL
  `;
  const params = [orgId];

  if (deviceId) {
    sql += ' AND acj.device_id = ?';
    params.push(deviceId);
  }
  if (status) {
    sql += ' AND acj.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY acj.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get a single AP command job by ID.
 */
async function getApCommandJob(id, orgId) {
  const [rows] = await db.query(
    `SELECT acj.*, d.hostname AS device_hostname
     FROM ap_command_jobs acj
     LEFT JOIN devices d ON d.id = acj.device_id
     WHERE acj.id = ?
       AND (acj.organization_id = ? OR acj.organization_id IS NULL)
       AND acj.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Create an AP command job.
 */
async function createApCommandJob(orgId, userId, data) {
  const { device_id } = data;

  // Verify device belongs to org
  const [devRows] = await db.query(
    'SELECT id FROM devices WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [device_id, orgId],
  );
  if (!devRows.length) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = data;
  const [result] = await db.query(
    'INSERT INTO ap_command_jobs SET ?',
    [{ organization_id: orgId, created_by: userId || null, status: 'pending', ...fields }],
  );
  return getApCommandJob(result.insertId, orgId);
}

/**
 * Cancel an AP command job (only if pending or queued).
 */
async function cancelApCommandJob(id, orgId) {
  const existing = await getApCommandJob(id, orgId);
  if (!existing) {
    const err = new Error('AP command job not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['pending', 'queued'].includes(existing.status)) {
    const err = new Error('Only pending or queued jobs can be cancelled');
    err.statusCode = 409;
    throw err;
  }
  await db.query(
    'UPDATE ap_command_jobs SET status = ?, updated_at = NOW() WHERE id = ?',
    ['cancelled', id],
  );
  return getApCommandJob(id, orgId);
}

// =============================================================================
// §9.2 Link Planning Calculator
// =============================================================================

/** Earth radius in km */
const EARTH_RADIUS_KM = 6371.0;

/**
 * Haversine great-circle distance between two lat/lon pairs.
 * Returns distance in kilometres.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Free-Space Path Loss (FSPL) in dB.
 * Formula: 20*log10(d_km * f_mhz * 4π / (c / 1e6))
 * Simplified: FSPL = 20*log10(d_km) + 20*log10(f_mhz) + 32.4447
 */
function fsplDb(distanceKm, frequencyMhz) {
  if (distanceKm <= 0 || frequencyMhz <= 0) return 0;
  return 20 * Math.log10(distanceKm) + 20 * Math.log10(frequencyMhz) + 32.4447;
}

/**
 * First Fresnel zone radius at the path midpoint, in metres.
 * r = 17.3 * sqrt(d_km / (4 * f_ghz))
 * where d_km is total path length and f_ghz is frequency in GHz.
 */
function fresnelRadiusM(distanceKm, frequencyMhz) {
  if (distanceKm <= 0 || frequencyMhz <= 0) return 0;
  const fGhz = frequencyMhz / 1000;
  return 17.3 * Math.sqrt(distanceKm / (4 * fGhz));
}

/**
 * Pure link budget calculator — no DB access.
 * Computes haversine distance, FSPL, Fresnel zone, clearance, and link budget.
 *
 * @param {object} params
 * @param {number} params.lat_a - Latitude of site A
 * @param {number} params.lon_a - Longitude of site A
 * @param {number} params.lat_b - Latitude of site B
 * @param {number} params.lon_b - Longitude of site B
 * @param {number} params.frequency_mhz - Operating frequency in MHz
 * @param {number} [params.tx_power_dbm] - Transmit power in dBm
 * @param {number} [params.antenna_gain_a_dbi] - Antenna gain at site A in dBi
 * @param {number} [params.antenna_gain_b_dbi] - Antenna gain at site B in dBi
 * @param {number} [params.cable_loss_db] - Cable/connector loss in dB (default 0)
 * @returns {object} Computed results
 */
function calculateLinkBudget({
  lat_a,
  lon_a,
  lat_b,
  lon_b,
  frequency_mhz,
  tx_power_dbm = null,
  antenna_gain_a_dbi = null,
  antenna_gain_b_dbi = null,
  cable_loss_db = 0,
}) {
  const distanceKm = haversineKm(
    parseFloat(lat_a),
    parseFloat(lon_a),
    parseFloat(lat_b),
    parseFloat(lon_b),
  );
  const fspl = fsplDb(distanceKm, frequency_mhz);
  const fresnelR = fresnelRadiusM(distanceKm, frequency_mhz);
  const clearanceRequired = 0.6 * fresnelR;

  let linkBudget = null;
  if (tx_power_dbm !== null && antenna_gain_a_dbi !== null && antenna_gain_b_dbi !== null) {
    linkBudget =
      parseFloat(tx_power_dbm) +
      parseFloat(antenna_gain_a_dbi) +
      parseFloat(antenna_gain_b_dbi) -
      fspl -
      parseFloat(cable_loss_db || 0);
  }

  return {
    distance_km: Math.round(distanceKm * 10000) / 10000,
    fspl_db: Math.round(fspl * 10000) / 10000,
    fresnel_radius_m: Math.round(fresnelR * 10000) / 10000,
    clearance_required_m: Math.round(clearanceRequired * 10000) / 10000,
    link_budget_db: linkBudget !== null ? Math.round(linkBudget * 10000) / 10000 : null,
  };
}

/**
 * Resolve coordinates for a link planning calculation.
 * If site_a_id / site_b_id are given, fetch lat/lon from sites table;
 * otherwise use the lat/lon overrides from the request body.
 */
async function _resolveCalcCoords(orgId, { site_a_id, site_b_id, lat_a, lon_a, lat_b, lon_b }) {
  let coordA = { lat: lat_a, lon: lon_a };
  let coordB = { lat: lat_b, lon: lon_b };

  if (site_a_id) {
    const [rows] = await db.query(
      'SELECT latitude, longitude FROM sites WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [site_a_id, orgId],
    );
    if (rows.length) {
      coordA = { lat: rows[0].latitude, lon: rows[0].longitude };
    }
  }
  if (site_b_id) {
    const [rows] = await db.query(
      'SELECT latitude, longitude FROM sites WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [site_b_id, orgId],
    );
    if (rows.length) {
      coordB = { lat: rows[0].latitude, lon: rows[0].longitude };
    }
  }
  return { coordA, coordB };
}

/**
 * Save a link planning calc to the DB (runs the calculator internally).
 */
async function saveCalc(body, orgId) {
  const { coordA, coordB } = await _resolveCalcCoords(orgId, body);

  const computed = calculateLinkBudget({
    lat_a: coordA.lat,
    lon_a: coordA.lon,
    lat_b: coordB.lat,
    lon_b: coordB.lon,
    frequency_mhz: body.frequency_mhz,
    tx_power_dbm: body.tx_power_dbm,
    antenna_gain_a_dbi: body.antenna_gain_a_dbi,
    antenna_gain_b_dbi: body.antenna_gain_b_dbi,
    cable_loss_db: body.cable_loss_db,
  });

  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = body;
  const row = {
    organization_id: orgId,
    ...fields,
    lat_a: coordA.lat,
    lon_a: coordA.lon,
    lat_b: coordB.lat,
    lon_b: coordB.lon,
    ...computed,
  };

  const [result] = await db.query('INSERT INTO link_planning_calcs SET ?', [row]);
  return getCalc(result.insertId, orgId);
}

/**
 * List saved link planning calcs for an org (paginated).
 */
async function listCalcs(orgId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const [rows] = await db.query(
    `SELECT lpc.*,
            sa.name AS site_a_name, sb.name AS site_b_name
     FROM link_planning_calcs lpc
     LEFT JOIN sites sa ON sa.id = lpc.site_a_id
     LEFT JOIN sites sb ON sb.id = lpc.site_b_id
     WHERE (lpc.organization_id = ? OR lpc.organization_id IS NULL)
       AND lpc.deleted_at IS NULL
     ORDER BY lpc.created_at DESC
     LIMIT ? OFFSET ?`,
    [orgId, Number(limit), Number(offset)],
  );
  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM link_planning_calcs WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [orgId],
  );
  return { data: rows, total, page: Number(page), limit: Number(limit) };
}

/**
 * Get a single saved link planning calc.
 */
async function getCalc(id, orgId) {
  const [rows] = await db.query(
    `SELECT lpc.*,
            sa.name AS site_a_name, sb.name AS site_b_name
     FROM link_planning_calcs lpc
     LEFT JOIN sites sa ON sa.id = lpc.site_a_id
     LEFT JOIN sites sb ON sb.id = lpc.site_b_id
     WHERE lpc.id = ?
       AND (lpc.organization_id = ? OR lpc.organization_id IS NULL)
       AND lpc.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Update a saved link planning calc (recalculates if coordinate/freq fields change).
 */
async function updateCalc(id, orgId, body) {
  const existing = await getCalc(id, orgId);
  if (!existing) {
    const err = new Error('Link planning calc not found');
    err.statusCode = 404;
    throw err;
  }

  const merged = { ...existing, ...body };
  const { coordA, coordB } = await _resolveCalcCoords(orgId, merged);
  const computed = calculateLinkBudget({
    lat_a: coordA.lat,
    lon_a: coordA.lon,
    lat_b: coordB.lat,
    lon_b: coordB.lon,
    frequency_mhz: merged.frequency_mhz,
    tx_power_dbm: merged.tx_power_dbm,
    antenna_gain_a_dbi: merged.antenna_gain_a_dbi,
    antenna_gain_b_dbi: merged.antenna_gain_b_dbi,
    cable_loss_db: merged.cable_loss_db,
  });

  const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = body;
  await db.query(
    'UPDATE link_planning_calcs SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [{ ...fields, ...computed, updated_at: new Date() }, id, orgId],
  );
  return getCalc(id, orgId);
}

/**
 * Soft-delete a saved link planning calc.
 */
async function deleteCalc(id, orgId) {
  const existing = await getCalc(id, orgId);
  if (!existing) {
    const err = new Error('Link planning calc not found');
    err.statusCode = 404;
    throw err;
  }
  await db.query(
    'UPDATE link_planning_calcs SET deleted_at = NOW() WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
    [id, orgId],
  );
}

// =============================================================================
// §9.2 PTP Link Metrics
// =============================================================================

/**
 * Get PTP link metrics for a specific network_links row.
 * Returns current signal/modulation/throughput data from the link record,
 * plus a time-series summary from wireless_client_sessions for linked devices.
 *
 * @param {string|number} linkId
 * @param {string|number} orgId
 * @param {number} hours - lookback window in hours (default 24)
 */
async function getPtpLinkMetrics(linkId, orgId, hours = 24) {
  const [linkRows] = await db.query(
    `SELECT nl.id, nl.link_type, nl.status, nl.capacity_mbps,
            nl.tx_signal_dbm, nl.rx_signal_dbm, nl.modulation,
            nl.tx_throughput_mbps, nl.rx_throughput_mbps, nl.link_budget_db,
            nl.failover_link_id, nl.is_primary, nl.failover_state,
            da.hostname AS device_a_hostname, da.ip_address AS device_a_ip,
            db_dev.hostname AS device_b_hostname, db_dev.ip_address AS device_b_ip
     FROM network_links nl
     LEFT JOIN devices da ON da.id = nl.device_a_id
     LEFT JOIN devices db_dev ON db_dev.id = nl.device_b_id
     WHERE nl.id = ?
       AND (nl.organization_id = ? OR nl.organization_id IS NULL)
       AND nl.deleted_at IS NULL`,
    [linkId, orgId],
  );
  if (!linkRows.length) return null;

  const link = linkRows[0];

  // Collect recent client session data from both endpoint devices as a proxy
  // for signal history (true PTP history requires a dedicated time-series store)
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const [sessionRows] = await db.query(
    `SELECT wcs.device_id, wcs.signal_dbm, wcs.noise_floor_dbm, wcs.snr_db,
            wcs.tx_rate_mbps, wcs.rx_rate_mbps, wcs.last_seen_at
     FROM wireless_client_sessions wcs
     WHERE wcs.device_id IN (
         SELECT device_a_id FROM network_links WHERE id = ?
         UNION
         SELECT device_b_id FROM network_links WHERE id = ?
     )
       AND (wcs.organization_id = ? OR wcs.organization_id IS NULL)
       AND wcs.last_seen_at >= ?
     ORDER BY wcs.last_seen_at DESC
     LIMIT 200`,
    [linkId, linkId, orgId, since],
  );

  return {
    link,
    session_history: sessionRows,
    history_hours: hours,
  };
}

// =============================================================================
// §9.3 RF Metrics — Signal Distribution
// =============================================================================

/**
 * Build a signal strength histogram from wireless_client_sessions.
 * Buckets: [-100,-90), [-90,-80), [-80,-70), [-70,-60), [-60,-50), [-50,0)
 *
 * @param {string|number} deviceId - AP device to filter by (optional if null = all org APs)
 * @param {string|number} orgId
 * @param {number} hours - lookback window in hours (default 24)
 */
async function getSignalDistribution(deviceId, orgId, hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const params = [orgId, since];

  let deviceFilter = '';
  if (deviceId) {
    deviceFilter = ' AND wcs.device_id = ?';
    params.push(deviceId);
  }

  const [rows] = await db.query(
    `SELECT
        SUM(CASE WHEN signal_dbm >= -100 AND signal_dbm < -90 THEN 1 ELSE 0 END) AS bucket_100_90,
        SUM(CASE WHEN signal_dbm >= -90  AND signal_dbm < -80 THEN 1 ELSE 0 END) AS bucket_90_80,
        SUM(CASE WHEN signal_dbm >= -80  AND signal_dbm < -70 THEN 1 ELSE 0 END) AS bucket_80_70,
        SUM(CASE WHEN signal_dbm >= -70  AND signal_dbm < -60 THEN 1 ELSE 0 END) AS bucket_70_60,
        SUM(CASE WHEN signal_dbm >= -60  AND signal_dbm < -50 THEN 1 ELSE 0 END) AS bucket_60_50,
        SUM(CASE WHEN signal_dbm >= -50             THEN 1 ELSE 0 END) AS bucket_50_0,
        COUNT(signal_dbm) AS total_sessions
     FROM wireless_client_sessions wcs
     WHERE (wcs.organization_id = ? OR wcs.organization_id IS NULL)
       AND wcs.last_seen_at >= ?
       AND wcs.signal_dbm IS NOT NULL${deviceFilter}`,
    params,
  );

  const r = rows[0];
  return {
    buckets: [
      { range: '[-100,-90)', label: '-100 to -90 dBm', count: Number(r.bucket_100_90) },
      { range: '[-90,-80)',  label: '-90 to -80 dBm',  count: Number(r.bucket_90_80) },
      { range: '[-80,-70)',  label: '-80 to -70 dBm',  count: Number(r.bucket_80_70) },
      { range: '[-70,-60)',  label: '-70 to -60 dBm',  count: Number(r.bucket_70_60) },
      { range: '[-60,-50)',  label: '-60 to -50 dBm',  count: Number(r.bucket_60_50) },
      { range: '[-50,0)',    label: '-50 to 0 dBm',    count: Number(r.bucket_50_0) },
    ],
    total_sessions: Number(r.total_sessions),
    device_id: deviceId || null,
    hours,
  };
}

// =============================================================================
// §9.3 Spectrum Scans
// =============================================================================

/**
 * List spectrum scan results for an org.
 */
async function listSpectrumScans(orgId, { deviceId, status, page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  let sql = `
    SELECT ssr.*, d.hostname AS device_hostname, d.ip_address AS device_ip
    FROM spectrum_scan_results ssr
    LEFT JOIN devices d ON d.id = ssr.device_id
    WHERE (ssr.organization_id = ? OR ssr.organization_id IS NULL)
      AND ssr.deleted_at IS NULL
  `;
  const params = [orgId];

  if (deviceId) {
    sql += ' AND ssr.device_id = ?';
    params.push(deviceId);
  }
  if (status) {
    sql += ' AND ssr.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY ssr.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await db.query(sql, params);

  let countSql = 'SELECT COUNT(*) AS total FROM spectrum_scan_results WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL';
  const countParams = [orgId];
  if (deviceId) {
    countSql += ' AND device_id = ?';
    countParams.push(deviceId);
  }
  if (status) {
    countSql += ' AND status = ?';
    countParams.push(status);
  }
  const [[{ total }]] = await db.query(countSql, countParams);

  return { data: rows, total, page: Number(page), limit: Number(limit) };
}

/**
 * Get a single spectrum scan result.
 */
async function getSpectrumScan(id, orgId) {
  const [rows] = await db.query(
    `SELECT ssr.*, d.hostname AS device_hostname
     FROM spectrum_scan_results ssr
     LEFT JOIN devices d ON d.id = ssr.device_id
     WHERE ssr.id = ?
       AND (ssr.organization_id = ? OR ssr.organization_id IS NULL)
       AND ssr.deleted_at IS NULL`,
    [id, orgId],
  );
  return rows[0] || null;
}

/**
 * Create a new spectrum scan record.
 * STUB: Live scanning requires hardware support. Sets status='completed' with
 * null scan_data and a note that live scanning requires hardware integration.
 *
 * @param {object} body - Request body
 * @param {string|number} orgId
 */
async function createSpectrumScan(body, orgId) {
  // Verify the AP device belongs to this org
  const [devRows] = await db.query(
    'SELECT id, type FROM devices WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
    [body.device_id, orgId],
  );
  if (!devRows.length) {
    const err = new Error('Device not found');
    err.statusCode = 404;
    throw err;
  }

  const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...fields } = body;
  const row = {
    organization_id: orgId,
    ...fields,
    status: 'completed',
    started_at: new Date(),
    completed_at: new Date(),
    scan_data: null,
    notes: (fields.notes ? fields.notes + ' | ' : '') +
      'Live spectrum scanning requires hardware support — scan_data populated by AP firmware integration',
  };

  const [result] = await db.query('INSERT INTO spectrum_scan_results SET ?', [row]);
  logger.info({ orgId, scanId: result.insertId, deviceId: body.device_id }, 'spectrum scan record created (stub)');
  return getSpectrumScan(result.insertId, orgId);
}

module.exports = {
  // AP sector configs
  listApSectorConfigs,
  getApSectorConfig,
  createApSectorConfig,
  updateApSectorConfig,
  deleteApSectorConfig,
  restoreApSectorConfig,
  // AP channel plans
  listApChannelPlans,
  getApChannelPlan,
  createApChannelPlan,
  updateApChannelPlan,
  deleteApChannelPlan,
  restoreApChannelPlan,
  detectChannelConflicts,
  // Wireless client sessions
  listWirelessClientSessions,
  recordClientSessions,
  // Channel interference
  listChannelInterference,
  createChannelInterference,
  updateChannelInterference,
  deleteChannelInterference,
  // AP command jobs
  listApCommandJobs,
  getApCommandJob,
  createApCommandJob,
  cancelApCommandJob,
  // §9.2 Link planning calculator
  calculateLinkBudget,
  saveCalc,
  listCalcs,
  getCalc,
  updateCalc,
  deleteCalc,
  // §9.2 PTP link metrics
  getPtpLinkMetrics,
  // §9.3 RF metrics
  getSignalDistribution,
  // §9.3 Spectrum scans
  listSpectrumScans,
  getSpectrumScan,
  createSpectrumScan,
};
