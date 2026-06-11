// =============================================================================
// FireISP 5.0 — Pool Utilization Service
// =============================================================================
// Computes IP pool utilization for all active pools across all orgs.
// Emits ip_pool.threshold events when utilization crosses 75% or 90%,
// and resets the alert state when usage falls back below 75%.
// =============================================================================
'use strict';

const db = require('../config/database');
const eventBus = require('./eventBus');
const logger = require('../utils/logger').child({ service: 'poolUtilization' });
const { parseIpv4Pool, parseIpv6Pool } = require('./poolAssignmentService');

/**
 * Compute the number of usable addresses (IPv4) or delegatable prefixes (IPv6)
 * in a pool.
 * @param {object} pool - ip_pools row
 * @returns {number}
 */
function computeUsableCount(pool) {
  if (pool.ip_version === '6') {
    if (!pool.default_prefix_len) return 0;
    const p = parseIpv6Pool(pool);
    if (!p) return 0;
    const blockSize = 1n << BigInt(128 - pool.default_prefix_len);
    const totalBlocks = (p.broadcastBig - p.networkBig + 1n) / blockSize;
    // Clamp to MAX_SAFE_INTEGER to avoid floating-point issues downstream
    const clamped = totalBlocks > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(totalBlocks);
    return clamped;
  }

  // IPv4: usable = all addresses excluding network and broadcast
  const p = parseIpv4Pool(pool);
  if (!p) return 0;
  return Math.max(0, p.broadcast - p.network - 1);
}

/**
 * Check utilization for every active pool across all organizations.
 * Fires ip_pool.threshold events when a new threshold (75 or 90) is crossed,
 * and resets last_alerted_threshold when usage drops below 75%.
 * @returns {Promise<{ checked: number }>}
 */
async function checkAllPoolUtilization() {
  const [pools] = await db.query(
    'SELECT * FROM ip_pools WHERE deleted_at IS NULL AND status = \'active\'',
  );

  for (const pool of pools) {
    try {
      const [assignedRows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM ip_assignments
         WHERE pool_id = ? AND deleted_at IS NULL AND status != 'expired'`,
        [pool.id],
      );
      const assigned = Number(assignedRows[0].cnt);
      const usable = computeUsableCount(pool);
      if (usable === 0) continue;

      const percent = Math.round((assigned / usable) * 100);

      // Determine which threshold (if any) has been crossed
      const threshold = percent >= 90 ? 90 : percent >= 75 ? 75 : null;
      const lastAlerted = pool.last_alerted_threshold !== null && pool.last_alerted_threshold !== undefined
        ? Number(pool.last_alerted_threshold)
        : null;

      if (threshold !== null && threshold !== lastAlerted) {
        // New threshold crossing — fire event
        eventBus.emit('ip_pool.threshold', {
          organizationId: pool.organization_id,
          pool,
          percent,
          threshold,
          assigned,
          usable,
        });
        // Record that this threshold was alerted
        await db.query(
          'UPDATE ip_pools SET last_alerted_threshold = ? WHERE id = ?',
          [threshold, pool.id],
        );
      } else if (threshold === null && lastAlerted !== null) {
        // Usage dropped below 75% — reset alert state
        await db.query(
          'UPDATE ip_pools SET last_alerted_threshold = NULL WHERE id = ?',
          [pool.id],
        );
      }
    } catch (err) {
      logger.error({ err, pool_id: pool.id }, 'Error checking pool utilization');
    }
  }

  return { checked: pools.length };
}

module.exports = { checkAllPoolUtilization, computeUsableCount };
