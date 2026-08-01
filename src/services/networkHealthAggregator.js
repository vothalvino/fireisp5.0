// =============================================================================
// FireISP 5.0 — daily network health aggregation
// =============================================================================
// Fills network_health_snapshots, which has been read by three places since
// migration 117 and written by nothing. The `populate_network_health_snapshots`
// task returned the string "populated by MySQL scheduled event" — an event that
// was never written — so it reported SUCCESS every night while doing nothing,
// and /network-health has been empty for its entire existence.
//
// Implemented here rather than as a MySQL EVENT, deliberately: a task in
// taskRunner is testable, appears in logs, reports real row counts, and fails
// visibly. An event is invisible to every one of those.
//
// ── Where each number actually comes from ────────────────────────────────────
//
// LATENCY   snmp_metrics_1hr.avg/max_latency_ms, device-level rows only
//           (interface_id = ''). Averaging the hourly averages is a slight
//           approximation — it weights every hour equally regardless of how
//           many polls it contains — and that is the right trade here: the
//           alternative is re-reading raw snmp_metrics, which is the table the
//           1hr rollup exists to avoid scanning.
//
// THROUGHPUT ifInOctets/ifOutOctets are COUNTERS, not rates. Averaging them is
//           meaningless — avg_if_in_octets is the average VALUE of an
//           ever-increasing number. The bytes moved in an hour are
//           max - min, so:
//                Mbps = (max - min) * 8 / 3600 / 1e6
//           A counter reset (device reboot, 32-bit wrap) makes max < min, or
//           produces an absurd delta; those hours are DISCARDED rather than
//           clamped, because a wrapped counter tells us nothing true about that
//           hour and inventing a zero would drag the daily average down.
//           Summed across interfaces first, so the figure is device total
//           throughput rather than one interface's.
//
// UPTIME    From `outages`, not from SNMP. An unreachable device stops
//           producing metrics entirely, so "no rows" is indistinguishable from
//           "polling was off" — outages is the only record that means downtime.
//           Overlap of each outage window with the day, clamped to the day's
//           bounds; an ongoing outage counts to the end of the day (or now).
//
// PACKET LOSS  LEFT NULL. There is no packet-loss column in snmp_metrics_1hr
//           and no other source. The column stays NULL rather than being filled
//           with a zero, because a confident 0.00% on an SLA report is a lie,
//           and this whole job exists because something reported success while
//           knowing nothing.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'networkHealthAggregator' });

const MINUTES_PER_DAY = 1440;

/** Hours whose delta exceeds this are treated as a counter reset, not traffic. */
const MAX_PLAUSIBLE_MBPS = 400000; // 400 Gbps — far above any ISP access device

/**
 * Aggregate one calendar day into network_health_snapshots.
 *
 * @param {number|null} organizationId  null aggregates every org (single-tenant
 *   installs carry NULL org on devices, so this must not be a bare equality).
 * @param {string} [day]  YYYY-MM-DD; defaults to yesterday, because today is
 *   still accumulating and a partial day written as final would understate
 *   throughput and uptime for whatever has not happened yet.
 */
async function aggregateDay(organizationId = null, day = null) {
  const snapshotDate = day || yesterday();

  const [rows] = await db.query(
    `
    SELECT
      d.id                  AS device_id,
      d.organization_id     AS organization_id,
      AVG(h.avg_latency_ms) AS avg_latency_ms,
      MAX(h.max_latency_ms) AS max_latency_ms,
      AVG(h.in_mbps)        AS avg_throughput_in_mbps,
      MAX(h.in_mbps)        AS peak_throughput_in_mbps,
      AVG(h.out_mbps)       AS avg_throughput_out_mbps,
      MAX(h.out_mbps)       AS peak_throughput_out_mbps
    FROM (
      -- Outer layer: discard hours whose delta is implausible. A counter reset
      -- can produce a huge positive jump as well as a negative one, and either
      -- is noise rather than traffic.
      SELECT
        per_hour.device_id,
        per_hour.avg_latency_ms,
        per_hour.max_latency_ms,
        CASE WHEN per_hour.in_raw  <= ? THEN per_hour.in_raw  END AS in_mbps,
        CASE WHEN per_hour.out_raw <= ? THEN per_hour.out_raw END AS out_mbps
      FROM (
        -- Inner layer: one row per device per hour. Latency comes from the
        -- device-level row; throughput is the counter delta summed across
        -- every interface, so the result is device total rather than one port.
        SELECT
          m.device_id,
          m.period_start,
          MAX(CASE WHEN m.interface_id = '' THEN m.avg_latency_ms END) AS avg_latency_ms,
          MAX(CASE WHEN m.interface_id = '' THEN m.max_latency_ms END) AS max_latency_ms,
          SUM(CASE WHEN m.max_if_in_octets >= m.min_if_in_octets
                   THEN (m.max_if_in_octets - m.min_if_in_octets) * 8 / 3600 / 1000000
              END) AS in_raw,
          SUM(CASE WHEN m.max_if_out_octets >= m.min_if_out_octets
                   THEN (m.max_if_out_octets - m.min_if_out_octets) * 8 / 3600 / 1000000
              END) AS out_raw
        FROM snmp_metrics_1hr m
        WHERE m.period_start >= ?
          AND m.period_start < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY m.device_id, m.period_start
      ) per_hour
    ) h
    JOIN devices d ON d.id = h.device_id AND d.deleted_at IS NULL
    WHERE (? IS NULL OR d.organization_id = ?)
    GROUP BY d.id, d.organization_id
    `,
    [MAX_PLAUSIBLE_MBPS, MAX_PLAUSIBLE_MBPS, snapshotDate, snapshotDate, organizationId, organizationId],
  );

  const downtime = await downtimeMinutesByDevice(organizationId, snapshotDate);

  let written = 0;
  for (const r of rows) {
    const minutesDown = Math.min(downtime.get(r.device_id) || 0, MINUTES_PER_DAY);
    const uptimePct = Number(
      (((MINUTES_PER_DAY - minutesDown) / MINUTES_PER_DAY) * 100).toFixed(2),
    );

    await db.query(
      `INSERT INTO network_health_snapshots
         (subject_key, organization_id, device_id, snapshot_date, uptime_pct,
          avg_latency_ms, max_latency_ms,
          avg_throughput_in_mbps, avg_throughput_out_mbps,
          peak_throughput_in_mbps, peak_throughput_out_mbps,
          packet_loss_pct, total_downtime_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE
          organization_id          = VALUES(organization_id),
          uptime_pct               = VALUES(uptime_pct),
          avg_latency_ms           = VALUES(avg_latency_ms),
          max_latency_ms           = VALUES(max_latency_ms),
          avg_throughput_in_mbps   = VALUES(avg_throughput_in_mbps),
          avg_throughput_out_mbps  = VALUES(avg_throughput_out_mbps),
          peak_throughput_in_mbps  = VALUES(peak_throughput_in_mbps),
          peak_throughput_out_mbps = VALUES(peak_throughput_out_mbps),
          total_downtime_minutes   = VALUES(total_downtime_minutes)`,
      [
        // subject_key folds the NULL half of (device_id, network_link_id) to 0
        // so the unique key has something to match on. Written here rather than
        // generated: MySQL forbids this table's ON DELETE SET NULL on a
        // generated column's base column.
        `${r.device_id}:0`,
        r.organization_id, r.device_id, snapshotDate, uptimePct,
        num(r.avg_latency_ms), num(r.max_latency_ms),
        num(r.avg_throughput_in_mbps), num(r.avg_throughput_out_mbps),
        num(r.peak_throughput_in_mbps), num(r.peak_throughput_out_mbps),
        minutesDown,
      ],
    );
    written += 1;
  }

  logger.info({ organizationId, snapshotDate, devices: written }, 'Network health snapshots written');
  return { snapshot_date: snapshotDate, devices: written };
}

/**
 * Downtime minutes per device for the day, from outages.
 *
 * Each outage is clamped to the day's bounds, so a three-day outage contributes
 * a full 1440 to each day it spans rather than its whole length to one. An
 * unresolved outage runs to the end of the day, or to now for today.
 */
async function downtimeMinutesByDevice(organizationId, snapshotDate) {
  const [rows] = await db.query(
    `SELECT o.device_id,
            SUM(
              GREATEST(0, TIMESTAMPDIFF(
                MINUTE,
                GREATEST(o.started_at, ?),
                LEAST(COALESCE(o.resolved_at, NOW()), DATE_ADD(?, INTERVAL 1 DAY))
              ))
            ) AS minutes_down
       FROM outages o
      WHERE o.device_id IS NOT NULL
        AND o.deleted_at IS NULL
        AND o.started_at < DATE_ADD(?, INTERVAL 1 DAY)
        AND COALESCE(o.resolved_at, NOW()) >= ?
        AND (? IS NULL OR o.organization_id = ? OR o.organization_id IS NULL)
      GROUP BY o.device_id`,
    [snapshotDate, snapshotDate, snapshotDate, snapshotDate, organizationId, organizationId],
  );
  return new Map(rows.map(r => [r.device_id, Number(r.minutes_down) || 0]));
}

/** DECIMAL columns come back as strings; null stays null rather than becoming 0. */
function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yesterday() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { aggregateDay, downtimeMinutesByDevice, _yesterday: yesterday, MAX_PLAUSIBLE_MBPS };
