// =============================================================================
// FireISP 5.0 — Fiber Plant Service (§7.4)
// =============================================================================
// Provides the interface layer for fiber route topology, ODF management,
// OTDR test records, and SFP lifecycle inventory.
//
// IMPLEMENTATION NOTE:
//   Live OTDR device I/O is stubbed — test results are imported manually
//   or scheduled via job records (same §7.1 stub-driver pattern).
//   The `job_status` field on otdr_test_results tracks acquisition state.
// =============================================================================

'use strict';

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'fiberPlantService' });

// ---------------------------------------------------------------------------
// Fiber Routes
// ---------------------------------------------------------------------------

/**
 * Get the full CO → splitter → ONU path for a given OLT port.
 * Returns fiber_routes segments linked to the port (trunk) and their children.
 * @param {number} oltPortId
 * @param {number|null} orgId
 * @returns {Promise<Array>}
 */
async function getFiberPathForPort(oltPortId, orgId) {
  const [rows] = await db.query(
    `SELECT
       fr.*,
       sp.name AS from_splitter_name,
       tsp.name AS to_splitter_name,
       fd.name AS from_device_name,
       td.name AS to_device_name
     FROM fiber_routes fr
     LEFT JOIN olt_splitters sp  ON sp.id  = fr.from_splitter_id
     LEFT JOIN olt_splitters tsp ON tsp.id = fr.to_splitter_id
     LEFT JOIN devices fd        ON fd.id  = fr.from_device_id
     LEFT JOIN devices td        ON td.id  = fr.to_device_id
     WHERE fr.from_olt_port_id = ?
       AND (fr.organization_id = ? OR fr.organization_id IS NULL)
       AND fr.deleted_at IS NULL
     ORDER BY fr.route_type ASC, fr.id ASC`,
    [oltPortId, orgId],
  );
  return rows;
}

/**
 * Get the fiber path terminating at an ONU (all segments leading to it).
 * @param {number} onuDetailId
 * @param {number|null} orgId
 * @returns {Promise<Array>}
 */
async function getFiberPathForOnu(onuDetailId, orgId) {
  const [rows] = await db.query(
    `SELECT
       fr.*,
       sp.name AS from_splitter_name,
       tsp.name AS to_splitter_name
     FROM fiber_routes fr
     LEFT JOIN olt_splitters sp  ON sp.id  = fr.from_splitter_id
     LEFT JOIN olt_splitters tsp ON tsp.id = fr.to_splitter_id
     WHERE fr.to_onu_detail_id = ?
       AND (fr.organization_id = ? OR fr.organization_id IS NULL)
       AND fr.deleted_at IS NULL
     ORDER BY fr.id ASC`,
    [onuDetailId, orgId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// ODF
// ---------------------------------------------------------------------------

/**
 * Get an ODF frame with its port summary.
 * @param {number} frameId
 * @param {number|null} orgId
 * @returns {Promise<object|null>}
 */
async function getOdfFrameWithPorts(frameId, orgId) {
  const [[frame]] = await db.query(
    `SELECT f.*, s.name AS site_name
     FROM odf_frames f
     LEFT JOIN sites s ON s.id = f.site_id
     WHERE f.id = ?
       AND (f.organization_id = ? OR f.organization_id IS NULL)
       AND f.deleted_at IS NULL`,
    [frameId, orgId],
  );
  if (!frame) return null;

  const [ports] = await db.query(
    `SELECT p.*,
            d.name AS connected_device_name,
            sp.name AS splitter_name
     FROM odf_ports p
     LEFT JOIN devices d ON d.id = p.connected_device_id
     LEFT JOIN olt_splitters sp ON sp.id = p.splitter_id
     WHERE p.odf_frame_id = ? AND p.deleted_at IS NULL
     ORDER BY p.port_number ASC`,
    [frameId],
  );

  return { ...frame, ports };
}

// ---------------------------------------------------------------------------
// OTDR
// ---------------------------------------------------------------------------

/**
 * Create an OTDR test result record (manual import or job placeholder).
 * @param {object} params
 * @returns {Promise<object>} created result row
 */
async function createOtdrTestResult(params) {
  const {
    orgId, fiberRouteId, oltPortId, oltDeviceId, testType,
    wavelengthNm, pulseWidthNs, rangeM,
    totalLossDb, totalLengthM,
    faultDetected, faultDistanceM, faultType,
    events, sorFilePath, jobStatus, testedAt, testedBy, notes,
  } = params;

  logger.info({ fiberRouteId, oltPortId, testType, faultDetected }, 'fiberPlantService.createOtdrTestResult');

  const [res] = await db.query(
    `INSERT INTO otdr_test_results
       (organization_id, fiber_route_id, olt_port_id, olt_device_id, test_type,
        wavelength_nm, pulse_width_ns, range_m,
        total_loss_db, total_length_m,
        fault_detected, fault_distance_m, fault_type,
        events, sor_file_path, job_status, tested_at, tested_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId, fiberRouteId || null, oltPortId || null, oltDeviceId || null, testType || 'manual',
      wavelengthNm || null, pulseWidthNs || null, rangeM || null,
      totalLossDb || null, totalLengthM || null,
      faultDetected ? 1 : 0, faultDistanceM || null, faultType || null,
      events ? JSON.stringify(events) : null,
      sorFilePath || null, jobStatus || 'imported',
      testedAt || null, testedBy || null, notes || null,
    ],
  );

  const [[result]] = await db.query('SELECT * FROM otdr_test_results WHERE id = ?', [res.insertId]);
  return result;
}

// ---------------------------------------------------------------------------
// SFP Inventory
// ---------------------------------------------------------------------------

/**
 * Get SFP diagnostic data for a device (from snmp_metrics) alongside its
 * sfp_inventory lifecycle record.
 * @param {number} deviceId
 * @param {number|null} orgId
 * @returns {Promise<{ inventory: object|null, diagnostics: object|null }>}
 */
async function getSfpDiagnosticsForDevice(deviceId, orgId) {
  const [invRows] = await db.query(
    `SELECT si.*, ii.name AS item_name, ii.model AS item_model
     FROM sfp_inventory si
     LEFT JOIN inventory_items ii ON ii.id = si.inventory_item_id
     WHERE si.installed_device_id = ?
       AND (si.organization_id = ? OR si.organization_id IS NULL)
       AND si.deleted_at IS NULL
       AND si.lifecycle_status = 'installed'
     ORDER BY si.installed_at DESC LIMIT 1`,
    [deviceId, orgId],
  );

  // Latest SNMP DDM diagnostics from snmp_metrics
  const [diagRows] = await db.query(
    `SELECT sfp_tx_power_dbm, sfp_rx_power_dbm, sfp_temperature_c, polled_at
     FROM snmp_metrics
     WHERE device_id = ?
       AND sfp_tx_power_dbm IS NOT NULL
     ORDER BY polled_at DESC LIMIT 1`,
    [deviceId],
  );

  return {
    inventory: invRows[0] || null,
    diagnostics: diagRows[0] || null,
  };
}

module.exports = {
  getFiberPathForPort,
  getFiberPathForOnu,
  getOdfFrameWithPorts,
  createOtdrTestResult,
  getSfpDiagnosticsForDevice,
};
