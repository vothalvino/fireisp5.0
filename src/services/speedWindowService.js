// =============================================================================
// FireISP 5.0 — Speed Window Service (§10.2)
// =============================================================================
// Time-based speed windows for plans. getActiveWindow() resolves the window
// in force for a plan right now; applySpeedWindows() converges RADIUS state
// to it:
//   • the plan group's radgroupreply speed rows are the PERSISTED applied
//     state — the FreeRADIUS SQL backend serves them to (re)connecting
//     sessions, and they double as the transition detector;
//   • live sessions are moved with a CoA-Request carrying the vendor
//     rate-limit attributes (Mikrotik-Rate-Limit et al).
// CoA fires only on TRANSITIONS (the stored rows differ from the desired
// state), so steady-state ticks are quiet, repeated runs are idempotent, and
// state survives restarts because it lives in the DB. If an out-of-band
// radius_sync rewrites the group with plan attributes mid-window, the next
// tick detects the mismatch and re-applies (self-healing; the sync itself is
// also window-aware — see radiusService.syncFreeradiusTables).
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'speedWindow' });
const { generateAttributes } = require('./radiusAttributeService');

// The attribute names generateAttributes() can emit across vendors — the
// slice of radgroupreply this service owns. Session-Timeout / Idle-Timeout /
// Login-Time rows are managed by radiusService.syncFreeradiusTables and are
// never touched here.
const SPEED_ATTRS = [
  'Mikrotik-Rate-Limit',
  'Cisco-AVPair',
  'ERX-Qos-Profile-Name',
  'ERX-Input-Gigapkts',
  'WISPr-Bandwidth-Max-Down',
  'WISPr-Bandwidth-Max-Up',
];

/**
 * Get the currently active speed window for a plan.
 * Returns the highest-priority (lowest priority number) window that matches
 * the current time and day of week.
 *
 * @param {number} planId
 * @returns {object|null} Speed window row or null if none active
 */
async function getActiveWindow(planId) {
  const now = new Date();
  const dayBit = 1 << now.getDay(); // bit0=Sun,...,bit6=Sat
  const currentTime = now.toTimeString().slice(0, 8); // HH:MM:SS

  const [rows] = await db.query(`
    SELECT *
    FROM plan_speed_windows
    WHERE plan_id = ?
      AND status = 'active'
      AND deleted_at IS NULL
      AND (day_mask & ?) > 0
      AND start_time <= ?
      AND end_time > ?
    ORDER BY priority ASC, id ASC
    LIMIT 1
  `, [planId, dayBit, currentTime, currentTime]);

  return rows[0] || null;
}

/**
 * Plan-shaped object with the window's speeds in force, for
 * radiusAttributeService.generateAttributes(). Bursts and burst thresholds
 * are intentionally cleared so generateAttributes() derives them from the
 * window CIR (2× / 1× defaults) instead of inheriting plan bursts sized for
 * different base speeds; vendor, queue priority and burst_time carry over.
 *
 * @param {object} plan   Plan row
 * @param {object} window plan_speed_windows row
 * @returns {object}
 */
function windowEffectivePlan(plan, window) {
  return {
    ...plan,
    download_speed_mbps: window.download_speed_mbps,
    upload_speed_mbps: window.upload_speed_mbps,
    burst_download_mbps: null,
    burst_upload_mbps: null,
    burst_threshold_mbps: null,
  };
}

/**
 * Expand a generateAttributes() map into [{attribute, value}] rows —
 * array values (e.g. Cisco-AVPair) become one row each. Mirrors the shape
 * radiusService.syncFreeradiusTables writes to radgroupreply.
 */
function expandRows(attrMap) {
  const rows = [];
  for (const [attribute, val] of Object.entries(attrMap)) {
    if (Array.isArray(val)) {
      for (const v of val) rows.push({ attribute, value: String(v) });
    } else {
      rows.push({ attribute, value: String(val) });
    }
  }
  return rows;
}

/** Order-insensitive multiset compare of {attribute, value} rows. */
function sameAttrRows(a, b) {
  if (a.length !== b.length) return false;
  const key = (r) => `${r.attribute}\t${r.value}`;
  const as = a.map(key).sort();
  const bs = b.map(key).sort();
  return as.every((v, i) => v === bs[i]);
}

/**
 * Converge every windowed plan's RADIUS speed state to the window (or plan)
 * currently in force, and CoA live sessions on transitions.
 *
 * @param {number|null} organizationId - null for global (all orgs)
 * @returns {object} Summary of results
 */
async function applySpeedWindows(organizationId) {
  // Lazy require: radiusService requires this module at load time for the
  // window-aware sync overlay — a top-level require back would be a cycle.
  const radiusService = require('./radiusService');

  const orgFilter = organizationId ? 'AND p.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  // Only plans that HAVE speed windows participate; all other plans' RADIUS
  // state is never touched by this task.
  const [plans] = await db.query(`
    SELECT DISTINCT p.id, p.download_speed_mbps, p.upload_speed_mbps,
           p.burst_download_mbps, p.burst_upload_mbps, p.burst_threshold_mbps,
           p.burst_time_seconds, p.radius_vendor, p.priority
    FROM plans p
    JOIN plan_speed_windows w ON w.plan_id = p.id AND w.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      ${orgFilter}
  `, params);

  const summary = {
    plans_checked: plans.length,
    transitions: 0,
    unchanged: 0,
    coa_sent: 0,
    coa_skipped_no_radius: 0,
    coa_skipped_vendor: 0,
    coa_errors: 0,
    errors: 0,
  };

  for (const plan of plans) {
    try {
      const window = await getActiveWindow(plan.id);
      const effective = window ? windowEffectivePlan(plan, window) : plan;
      const attrMap = generateAttributes(effective);
      const desired = expandRows(attrMap);
      // Group naming convention shared with radiusService.planGroupName()
      // and any external FreeRADIUS deployment reading these tables.
      const group = `plan_${plan.id}`;

      const inList = SPEED_ATTRS.map(() => '?').join(', ');
      const [currentRows] = await db.query(
        `SELECT attribute, value FROM radgroupreply
         WHERE groupname = ? AND attribute IN (${inList})`,
        [group, ...SPEED_ATTRS],
      );

      if (sameAttrRows(currentRows, desired)) {
        summary.unchanged++;
        continue;
      }

      // Persist the new applied state — (re)connecting sessions served from
      // the FreeRADIUS SQL backend pick it up immediately. One transaction:
      // a crash between the DELETE and the INSERTs would otherwise leave the
      // group with NO speed rows, and FreeRADIUS would accept sessions
      // UNCAPPED until the next tick healed it. (radius_sync's full-group
      // delete+reinsert remains a concurrent writer; post-parity both compute
      // identical rows, and its rewrite clears any transient duplicate.)
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute(
          `DELETE FROM radgroupreply WHERE groupname = ? AND attribute IN (${inList})`,
          [group, ...SPEED_ATTRS],
        );
        for (const row of desired) {
          await conn.execute(
            'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
            [group, row.attribute, '=', row.value],
          );
        }
        await conn.commit();
      } catch (txErr) {
        await conn.rollback().catch(() => {});
        throw txErr;
      } finally {
        conn.release();
      }
      summary.transitions++;
      logger.info(
        { planId: plan.id, windowId: window ? window.id : null },
        window ? 'Speed window engaged for plan' : 'Speed window ended for plan — plan speeds restored',
      );

      // Move live sessions with a CoA. radiusCoaEncoder has no Juniper ERX
      // encoders — the radgroupreply write above still covers reconnects, but
      // live juniper sessions keep their current rate until re-auth.
      if (plan.radius_vendor === 'juniper') {
        summary.coa_skipped_vendor++;
        logger.warn({ planId: plan.id }, 'Speed window: juniper CoA attributes not supported — live sessions unchanged until reconnect');
        continue;
      }

      const named = [];
      for (const [name, value] of Object.entries(attrMap)) {
        if (Array.isArray(value)) value.forEach((v) => named.push({ name, value: String(v) }));
        else named.push({ name, value: String(value) });
      }

      // Walled-garden and soft-suspended contracts keep status='active' and
      // ARE swept here — harmless today: walled garden enforces via the
      // per-user address-list (never touched by this CoA), and soft-suspend
      // sends no rate attributes yet (TODO in suspensionService). If
      // soft-suspend rate-limiting ever lands, exclude soft-suspended
      // contracts from this fan-out or the window CoA would lift the throttle.
      const [contracts] = await db.query(
        `SELECT id FROM contracts
         WHERE plan_id = ? AND status = 'active' AND deleted_at IS NULL`,
        [plan.id],
      );

      for (const contract of contracts) {
        try {
          const result = await radiusService.changeOfAuth(contract.id, 'update', named);
          if (result && result.sent === false) summary.coa_skipped_no_radius++;
          else summary.coa_sent++;
        } catch (err) {
          summary.coa_errors++;
          logger.warn({ contractId: contract.id, err: err.message }, 'Speed window CoA failed');
        }
      }
    } catch (err) {
      summary.errors++;
      logger.warn({ planId: plan.id, err: err.message }, 'Speed window apply failed for plan');
    }
  }

  return summary;
}

module.exports = { getActiveWindow, windowEffectivePlan, applySpeedWindows };
