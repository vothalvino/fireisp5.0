// =============================================================================
// FireISP 5.0 — SNMP Metrics Routes
// =============================================================================
// Provides time-series SNMP metric data for the frontend charts page.
//
// GET /snmp-metrics
//   Query params:
//     device_id   (required) — device to query
//     resolution  raw | 1hr | 1day  (default: 1hr)
//                   raw   → snmp_metrics        (5-min samples, default last 24 h)
//                   1hr   → snmp_metrics_1hr    (hourly averages, default last 7 d)
//                   1day  → snmp_metrics_1day   (daily averages, default last 30 d)
//     hours       override lookback window in hours (integer, max 8760)
//     interface_id  optional ifIndex/ifDescr filter; pass '' for device-level
//
// GET /snmp-metrics/devices
//   Returns a short list of SNMP-enabled devices (id, name, ip_address,
//   snmp_profile_id) for the device-selector dropdown.
//
// GET /snmp-metrics/top-talkers  §6.3
//   Query params:
//     hours     lookback window (default 24, max 8760)
//     limit     number of results (default 10, max 100)
//   Returns top interfaces sorted by total bytes (in+out) in the window.
//
// GET /snmp-metrics/interfaces/:deviceId  §6.3
//   Returns per-interface utilization stats for a device (latest 1hr row per iface).
//
// GET /snmp-metrics/errors  §6.3
//   Query params:
//     device_id   (required)
//     hours       lookback window (default 24, max 8760)
//   Returns error/discard counters per interface.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// GET /snmp-metrics/devices  — list SNMP-enabled devices for the dropdown
// ---------------------------------------------------------------------------
router.get('/devices', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, ip_address, snmp_profile_id, status
       FROM devices
       WHERE snmp_enabled = 1
         AND deleted_at IS NULL
       ORDER BY name ASC
       LIMIT 500`,
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /snmp-metrics/top-talkers  §6.3 — top interfaces by total bytes
// ---------------------------------------------------------------------------
router.get('/top-talkers', requirePermission('snmp_metrics.top_talkers'), async (req, res, next) => {
  try {
    const maxHours = 8760;
    const rawHours = parseInt(req.query.hours, 10);
    const lookbackHours = (rawHours > 0 && rawHours <= maxHours) ? rawHours : 24;
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = (rawLimit > 0 && rawLimit <= 100) ? rawLimit : 10;

    // Use 1hr aggregates for performance. Join with devices to enforce org scope.
    const [rows] = await db.query(
      `SELECT m.device_id, d.name AS device_name, d.ip_address,
              m.interface_id,
              CAST(SUM(COALESCE(m.avg_if_in_octets, 0) + COALESCE(m.avg_if_out_octets, 0)) AS UNSIGNED) AS total_bytes,
              CAST(SUM(COALESCE(m.avg_if_in_octets, 0)) AS UNSIGNED) AS total_in_bytes,
              CAST(SUM(COALESCE(m.avg_if_out_octets, 0)) AS UNSIGNED) AS total_out_bytes,
              SUM(m.sample_count) AS samples
       FROM snmp_metrics_1hr m
       JOIN devices d ON d.id = m.device_id
       WHERE m.period_start >= NOW() - INTERVAL ? HOUR
         AND d.organization_id = ?
         AND d.deleted_at IS NULL
         AND m.interface_id != ''
       GROUP BY m.device_id, d.name, d.ip_address, m.interface_id
       ORDER BY total_bytes DESC
       LIMIT ?`,
      [lookbackHours, req.orgId, limit],
    );

    res.json({
      data: rows,
      meta: { lookback_hours: lookbackHours, limit },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /snmp-metrics/interfaces/:deviceId  §6.3 — per-interface utilization
// ---------------------------------------------------------------------------
router.get('/interfaces/:deviceId', requirePermission('snmp_metrics.interfaces'), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    if (!deviceId || Number.isNaN(deviceId)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'deviceId must be an integer' } });
    }

    // Verify the device belongs to the org
    const [devRows] = await db.query(
      'SELECT id, name, ip_address FROM devices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [deviceId, req.orgId],
    );
    if (!devRows.length) {
      return res.status(404).json({ error: { message: 'Device not found' } });
    }

    // Fetch the most recent 1hr row per interface for this device
    const [rows] = await db.query(
      `SELECT m.interface_id,
              m.avg_if_in_octets  AS if_in_octets_avg,
              m.avg_if_out_octets AS if_out_octets_avg,
              m.max_if_in_octets  AS if_in_octets_max,
              m.max_if_out_octets AS if_out_octets_max,
              m.avg_if_in_errors  AS if_in_errors_avg,
              m.avg_if_out_errors AS if_out_errors_avg,
              m.avg_if_in_discards  AS if_in_discards_avg,
              m.avg_if_out_discards AS if_out_discards_avg,
              m.avg_sfp_tx_power_dbm, m.avg_sfp_rx_power_dbm,
              m.avg_sfp_temperature_c,
              m.avg_poe_power_mw,
              m.avg_if_oper_status, m.min_if_oper_status,
              m.period_start
       FROM snmp_metrics_1hr m
       INNER JOIN (
         SELECT interface_id, MAX(period_start) AS latest
         FROM snmp_metrics_1hr
         WHERE device_id = ? AND interface_id != ''
         GROUP BY interface_id
       ) latest_rows ON m.interface_id = latest_rows.interface_id AND m.period_start = latest_rows.latest
       WHERE m.device_id = ?
       ORDER BY m.interface_id`,
      [deviceId, deviceId],
    );

    res.json({
      data: rows,
      meta: { device_id: deviceId, device_name: devRows[0].name, ip_address: devRows[0].ip_address },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /snmp-metrics/errors  §6.3 — error/discard counters per interface
// ---------------------------------------------------------------------------
router.get('/errors', requirePermission('snmp_metrics.view'), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.query.device_id, 10);
    if (!deviceId || Number.isNaN(deviceId)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'device_id is required' } });
    }
    const maxHours = 8760;
    const rawHours = parseInt(req.query.hours, 10);
    const lookbackHours = (rawHours > 0 && rawHours <= maxHours) ? rawHours : 24;

    const [rows] = await db.query(
      `SELECT m.interface_id,
              SUM(COALESCE(m.avg_if_in_errors, 0))    AS total_in_errors,
              SUM(COALESCE(m.avg_if_out_errors, 0))   AS total_out_errors,
              MAX(m.max_if_in_errors)                  AS peak_in_errors,
              MAX(m.max_if_out_errors)                 AS peak_out_errors,
              SUM(COALESCE(m.avg_if_in_discards, 0))  AS total_in_discards,
              SUM(COALESCE(m.avg_if_out_discards, 0)) AS total_out_discards,
              MAX(m.max_if_in_discards)                AS peak_in_discards,
              MAX(m.max_if_out_discards)               AS peak_out_discards,
              SUM(m.sample_count)                      AS samples
       FROM snmp_metrics_1hr m
       JOIN devices d ON d.id = m.device_id
       WHERE m.device_id = ?
         AND m.period_start >= NOW() - INTERVAL ? HOUR
         AND d.organization_id = ?
         AND d.deleted_at IS NULL
       GROUP BY m.interface_id
       ORDER BY (total_in_errors + total_out_errors + total_in_discards + total_out_discards) DESC`,
      [deviceId, lookbackHours, req.orgId],
    );

    res.json({
      data: rows,
      meta: { device_id: deviceId, lookback_hours: lookbackHours },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /snmp-metrics  — time-series metrics for a single device
// ---------------------------------------------------------------------------
router.get('/', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const deviceId = parseInt(req.query.device_id, 10);
    if (!deviceId || Number.isNaN(deviceId)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'device_id is required' } });
    }

    const resolution = ['raw', '1hr', '1day'].includes(req.query.resolution)
      ? req.query.resolution
      : '1hr';

    // Default lookback windows (hours)
    const defaultHours = { raw: 24, '1hr': 7 * 24, '1day': 30 * 24 };
    const maxHours = 8760; // 1 year cap
    const rawHours = parseInt(req.query.hours, 10);
    const lookbackHours = (rawHours > 0 && rawHours <= maxHours)
      ? rawHours
      : defaultHours[resolution];

    // interface_id filter — empty string means "device-level rows only"
    const interfaceId = req.query.interface_id;
    const filterInterface = interfaceId !== undefined;

    if (resolution === 'raw') {
      // -----------------------------------------------------------------------
      // Raw 5-min samples from snmp_metrics
      // -----------------------------------------------------------------------
      const conditions = ['device_id = ?', 'polled_at >= NOW() - INTERVAL ? HOUR'];
      const params = [deviceId, lookbackHours];

      if (filterInterface) {
        if (interfaceId === '') {
          conditions.push('interface_id IS NULL');
        } else {
          conditions.push('interface_id = ?');
          params.push(interfaceId);
        }
      }

      const [rows] = await db.query(
        `SELECT polled_at AS ts, interface_id,
                if_in_octets, if_out_octets,
                if_in_errors, if_out_errors,
                if_in_discards, if_out_discards,
                cpu_usage, memory_usage,
                signal_strength, latency_ms,
                voltage_mv, temperature_c, fan_speed_rpm,
                sfp_tx_power_dbm, sfp_rx_power_dbm, sfp_temperature_c,
                ups_battery_pct, ups_runtime_min, poe_power_mw, humidity_pct
         FROM snmp_metrics
         WHERE ${conditions.join(' AND ')}
         ORDER BY polled_at ASC
         LIMIT 2000`,
        params,
      );

      // Collect distinct interfaces seen in this window
      const ifaceSet = new Set();
      for (const r of rows) {
        if (r.interface_id !== null) ifaceSet.add(r.interface_id);
      }

      return res.json({
        data: rows,
        meta: { device_id: deviceId, resolution, lookback_hours: lookbackHours, interfaces: [...ifaceSet] },
      });
    }

    if (resolution === '1hr') {
      // -----------------------------------------------------------------------
      // Hourly aggregates from snmp_metrics_1hr
      // -----------------------------------------------------------------------
      const conditions = ['device_id = ?', 'period_start >= NOW() - INTERVAL ? HOUR'];
      const params = [deviceId, lookbackHours];

      if (filterInterface) {
        // In snmp_metrics_1hr, device-level rows use interface_id = '' (NOT NULL DEFAULT '').
        // An empty interfaceId selects device-level rows; any non-empty value selects that interface.
        if (interfaceId === '') {
          conditions.push('interface_id = ?');
          params.push('');
        } else {
          conditions.push('interface_id = ?');
          params.push(interfaceId);
        }
      }

      const [rows] = await db.query(
        `SELECT period_start AS ts, interface_id,
                avg_if_in_octets  AS if_in_octets,
                avg_if_out_octets AS if_out_octets,
                avg_if_in_errors  AS if_in_errors,
                avg_if_out_errors AS if_out_errors,
                avg_if_in_discards  AS if_in_discards,
                avg_if_out_discards AS if_out_discards,
                avg_cpu_usage     AS cpu_usage,
                avg_memory_usage  AS memory_usage,
                avg_signal_strength AS signal_strength,
                avg_latency_ms    AS latency_ms,
                min_latency_ms, max_latency_ms,
                min_cpu_usage, max_cpu_usage,
                avg_voltage_mv AS voltage_mv, avg_temperature_c AS temperature_c,
                avg_fan_speed_rpm AS fan_speed_rpm,
                avg_sfp_tx_power_dbm AS sfp_tx_power_dbm,
                avg_sfp_rx_power_dbm AS sfp_rx_power_dbm,
                avg_sfp_temperature_c AS sfp_temperature_c,
                avg_ups_battery_pct AS ups_battery_pct,
                avg_ups_runtime_min AS ups_runtime_min,
                avg_poe_power_mw AS poe_power_mw,
                avg_humidity_pct AS humidity_pct,
                sample_count
         FROM snmp_metrics_1hr
         WHERE ${conditions.join(' AND ')}
         ORDER BY period_start ASC
         LIMIT 2000`,
        params,
      );

      const ifaceSet = new Set();
      for (const r of rows) {
        if (r.interface_id !== '') ifaceSet.add(r.interface_id);
      }

      return res.json({
        data: rows,
        meta: { device_id: deviceId, resolution, lookback_hours: lookbackHours, interfaces: [...ifaceSet] },
      });
    }

    // resolution === '1day'
    // -----------------------------------------------------------------------
    // Daily aggregates from snmp_metrics_1day
    // -----------------------------------------------------------------------
    const conditions = ['device_id = ?', 'period_start >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'];
    const params = [deviceId, Math.ceil(lookbackHours / 24)];

    if (filterInterface) {
      // In snmp_metrics_1day, device-level rows use interface_id = '' (NOT NULL DEFAULT '').
      // An empty interfaceId selects device-level rows; any non-empty value selects that interface.
      if (interfaceId === '') {
        conditions.push('interface_id = ?');
        params.push('');
      } else {
        conditions.push('interface_id = ?');
        params.push(interfaceId);
      }
    }

    const [rows] = await db.query(
      `SELECT period_start AS ts, interface_id,
              avg_if_in_octets  AS if_in_octets,
              avg_if_out_octets AS if_out_octets,
              avg_if_in_errors  AS if_in_errors,
              avg_if_out_errors AS if_out_errors,
              avg_if_in_discards  AS if_in_discards,
              avg_if_out_discards AS if_out_discards,
              avg_cpu_usage     AS cpu_usage,
              avg_memory_usage  AS memory_usage,
              avg_signal_strength AS signal_strength,
              avg_latency_ms    AS latency_ms,
              min_latency_ms, max_latency_ms,
              min_cpu_usage, max_cpu_usage,
              avg_voltage_mv AS voltage_mv, avg_temperature_c AS temperature_c,
              avg_fan_speed_rpm AS fan_speed_rpm,
              avg_sfp_tx_power_dbm AS sfp_tx_power_dbm,
              avg_sfp_rx_power_dbm AS sfp_rx_power_dbm,
              avg_sfp_temperature_c AS sfp_temperature_c,
              avg_ups_battery_pct AS ups_battery_pct,
              avg_ups_runtime_min AS ups_runtime_min,
              avg_poe_power_mw AS poe_power_mw,
              avg_humidity_pct AS humidity_pct,
              sample_count
       FROM snmp_metrics_1day
       WHERE ${conditions.join(' AND ')}
       ORDER BY period_start ASC
       LIMIT 2000`,
      params,
    );

    const ifaceSet = new Set();
    for (const r of rows) {
      if (r.interface_id !== '') ifaceSet.add(r.interface_id);
    }

    return res.json({
      data: rows,
      meta: { device_id: deviceId, resolution, lookback_hours: lookbackHours, interfaces: [...ifaceSet] },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
