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
                cpu_usage, memory_usage,
                signal_strength, latency_ms
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
        conditions.push('interface_id = ?');
        params.push(interfaceId || '');
      }

      const [rows] = await db.query(
        `SELECT period_start AS ts, interface_id,
                avg_if_in_octets  AS if_in_octets,
                avg_if_out_octets AS if_out_octets,
                avg_if_in_errors  AS if_in_errors,
                avg_if_out_errors AS if_out_errors,
                avg_cpu_usage     AS cpu_usage,
                avg_memory_usage  AS memory_usage,
                avg_signal_strength AS signal_strength,
                avg_latency_ms    AS latency_ms,
                min_latency_ms, max_latency_ms,
                min_cpu_usage, max_cpu_usage,
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
      conditions.push('interface_id = ?');
      params.push(interfaceId || '');
    }

    const [rows] = await db.query(
      `SELECT period_start AS ts, interface_id,
              avg_if_in_octets  AS if_in_octets,
              avg_if_out_octets AS if_out_octets,
              avg_if_in_errors  AS if_in_errors,
              avg_if_out_errors AS if_out_errors,
              avg_cpu_usage     AS cpu_usage,
              avg_memory_usage  AS memory_usage,
              avg_signal_strength AS signal_strength,
              avg_latency_ms    AS latency_ms,
              min_latency_ms, max_latency_ms,
              min_cpu_usage, max_cpu_usage,
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
