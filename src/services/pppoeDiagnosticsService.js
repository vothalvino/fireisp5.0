// =============================================================================
// FireISP 5.0 — PPPoE Diagnostics Service
// =============================================================================
// Provides auth-failure classification, MTU mismatch detection, and RouterOS
// log line parsing for PPPoE diagnostics.
// =============================================================================

const db = require('../config/database');
const eventBus = require('./eventBus');
const logger = require('../utils/logger').child({ service: 'pppoeDiagnostics' });

// Default threshold for auth failure alerting (per-org setting overrides this)
const DEFAULT_AUTH_FAILURE_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// RouterOS log line parser
// ---------------------------------------------------------------------------

/**
 * Parse a RouterOS PPPoE syslog line into { stage, severity, reason_code, message }.
 * Returns null if the line cannot be recognized as a known PPPoE event.
 *
 * Pattern coverage:
 *   PADI from <MAC>                       → PADI / info / padi_received
 *   no free PPPoE service / no pppoe service → PADS / error / no_service
 *   LCP negotiation failed / LCP: timeout → LCP  / error / lcp_failed
 *   terminating.*peer is not responding   → PADT / warning / peer_timeout
 *   IPCP negotiation failed               → IPCP / error / ipcp_failed
 *   authenticated / login correct         → AUTH / info  / auth_ok
 *   login incorrect / wrong password / invalid password → AUTH / error / auth_failed
 *   connected / pppoe: connected          → PADS / info  / connected
 *   disconnected                          → PADT / info  / disconnected
 *   CHAP / PAP / MSCHAPV2 negotiation     → AUTH / info  / auth_negotiation
 *
 * @param {string} line - Raw syslog line
 * @returns {{ stage: string, severity: string, reason_code: string, message: string }|null}
 */
function parseRouterOsLogLine(line) {
  if (!line || typeof line !== 'string') return null;
  const l = line.trim();

  // PADI from <MAC>
  if (/PADI from /i.test(l)) {
    return { stage: 'PADI', severity: 'info', reason_code: 'padi_received', message: l };
  }

  // No PPPoE service available
  if (/no free pppoe service|no pppoe service/i.test(l)) {
    return { stage: 'PADS', severity: 'error', reason_code: 'no_service', message: l };
  }

  // LCP failures
  if (/LCP negotiation failed|LCP:\s*timeout/i.test(l)) {
    return { stage: 'LCP', severity: 'error', reason_code: 'lcp_failed', message: l };
  }

  // Peer not responding (graceful termination)
  if (/terminating.*peer is not responding/i.test(l)) {
    return { stage: 'PADT', severity: 'warning', reason_code: 'peer_timeout', message: l };
  }

  // IPCP failure
  if (/IPCP negotiation failed/i.test(l)) {
    return { stage: 'IPCP', severity: 'error', reason_code: 'ipcp_failed', message: l };
  }

  // Disconnected (check before connected to avoid substring match)
  if (/\bdisconnected\b/i.test(l)) {
    return { stage: 'PADT', severity: 'info', reason_code: 'disconnected', message: l };
  }

  // Auth success
  if (/\bauthenticated\b|login correct/i.test(l)) {
    return { stage: 'AUTH', severity: 'info', reason_code: 'auth_ok', message: l };
  }

  // Auth failure
  if (/login incorrect|wrong password|invalid password/i.test(l)) {
    return { stage: 'AUTH', severity: 'error', reason_code: 'auth_failed', message: l };
  }

  // Connected
  if (/pppoe:\s*connected|\bconnected\b/i.test(l)) {
    return { stage: 'PADS', severity: 'info', reason_code: 'connected', message: l };
  }

  // Auth protocol negotiation (CHAP / PAP / MSCHAPV2)
  if (/\bCHAP\b|\bPAP\b|\bMSCHAPV2\b/i.test(l) && /negotiation/i.test(l)) {
    return { stage: 'AUTH', severity: 'info', reason_code: 'auth_negotiation', message: l };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auth failure classification
// ---------------------------------------------------------------------------

/**
 * Classify auth failures from radpostauth for a given organization and time window.
 *
 * Org scoping: radpostauth has no organization_id. We scope by joining usernames
 * against the `radius` table (which does have organization_id). When orgId is
 * provided, only records for usernames present in the radius table for that org
 * are included.
 *
 * Failure reasons:
 *   bad_password   — username exists in radcheck (known user, wrong cred)
 *   unknown_user   — username absent from radcheck
 *   session_limit  — reply contains 'simultaneous' (case-insensitive)
 *   no_pool        — reply contains 'no free' or 'no pool' heuristic
 *   other          — everything else
 *
 * @param {number|null} orgId
 * @param {Date|string|null} since
 * @param {Date|string|null} until
 * @param {string|null} [username]
 * @returns {Promise<{ failures: object[], counts: object, total: number }>}
 */
async function classifyAuthFailures(orgId, since, until, username) {
  // Build radpostauth rejection query
  let sql = `
    SELECT rpa.username, rpa.authdate, rpa.nas_ip_address, rpa.calling_station_id, rpa.reply
    FROM radpostauth rpa
    WHERE rpa.reply NOT LIKE 'Access-Accept%'
  `;
  const params = [];

  if (since) {
    sql += ' AND rpa.authdate >= ?';
    params.push(since);
  }
  if (until) {
    sql += ' AND rpa.authdate <= ?';
    params.push(until);
  }
  if (username) {
    sql += ' AND rpa.username = ?';
    params.push(username);
  }

  // Org scoping: join to radius table to restrict to org's usernames
  if (orgId) {
    sql += ` AND rpa.username IN (
      SELECT r2.username FROM radius r2
      WHERE r2.organization_id = ? AND r2.deleted_at IS NULL
    )`;
    params.push(orgId);
  }

  sql += ' ORDER BY rpa.authdate DESC LIMIT 1000';

  const [rejectedRows] = await db.query(sql, params);

  if (rejectedRows.length === 0) {
    return {
      failures: [],
      counts: { bad_password: 0, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 },
      total: 0,
    };
  }

  // Load known usernames from radcheck (batch lookup for efficiency)
  const uniqueUsernames = [...new Set(rejectedRows.map(r => r.username))];
  const placeholders = uniqueUsernames.map(() => '?').join(',');
  const [radcheckRows] = await db.query(
    `SELECT DISTINCT username FROM radcheck WHERE username IN (${placeholders})`,
    uniqueUsernames,
  );
  const knownUsers = new Set(radcheckRows.map(r => r.username));

  const counts = { bad_password: 0, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 };
  const failures = [];

  for (const row of rejectedRows) {
    let reason;

    if (/simultaneous/i.test(row.reply)) {
      reason = 'session_limit';
    } else if (/no free|no pool/i.test(row.reply)) {
      reason = 'no_pool';
    } else if (knownUsers.has(row.username)) {
      reason = 'bad_password';
    } else {
      reason = 'unknown_user';
    }

    counts[reason]++;
    failures.push({
      username: row.username,
      authdate: row.authdate,
      nas_ip_address: row.nas_ip_address,
      calling_station_id: row.calling_station_id,
      reason,
      reply: row.reply,
    });
  }

  return { failures, counts, total: failures.length };
}

// ---------------------------------------------------------------------------
// MTU issue detection
// ---------------------------------------------------------------------------

/**
 * Detect MTU misconfiguration advisories for an organization.
 *
 * Two advisory types:
 *   mtu_exceeds_pppoe_ceiling  — profiles with MTU > 1492 (standard PPPoE ceiling
 *                                 over Ethernet; higher values may fragment traffic)
 *   lcp_failure_mtu_mismatch   — usernames with ≥3 LCP errors in the last 24h
 *                                 whose effective service profile has MTU != 1492.
 *                                 NOTE: The LCP→MTU correlation is heuristic; a
 *                                 profile with non-1492 MTU and LCP errors may be
 *                                 unrelated to MTU configuration (e.g. line noise).
 *
 * @param {number|null} orgId
 * @returns {Promise<{ advisories: object[] }>}
 */
async function detectMtuIssues(orgId) {
  const advisories = [];

  // --- Type 1: profiles with MTU > 1492 ---
  let profileSql = `
    SELECT id, name, mtu
    FROM pppoe_service_profiles
    WHERE deleted_at IS NULL
      AND mtu > 1492
  `;
  const profileParams = [];
  if (orgId) {
    profileSql += ' AND organization_id = ?';
    profileParams.push(orgId);
  }

  const [highMtuProfiles] = await db.query(profileSql, profileParams);
  for (const profile of highMtuProfiles) {
    advisories.push({
      type: 'mtu_exceeds_pppoe_ceiling',
      profile_id: profile.id,
      profile_name: profile.name,
      mtu: profile.mtu,
      description: `Profile "${profile.name}" has MTU ${profile.mtu} which exceeds the standard PPPoE ceiling of 1492. This may cause fragmentation for clients behind Ethernet links.`,
    });
  }

  // --- Type 2: LCP failures correlated with non-1492 MTU profiles ---
  // Find usernames with ≥3 LCP errors in the last 24 hours
  let lcpSql = `
    SELECT username, COUNT(*) AS failure_count
    FROM pppoe_event_logs
    WHERE stage = 'LCP'
      AND severity = 'error'
      AND logged_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND username IS NOT NULL
  `;
  const lcpParams = [];
  if (orgId) {
    lcpSql += ' AND organization_id = ?';
    lcpParams.push(orgId);
  }
  lcpSql += ' GROUP BY username HAVING COUNT(*) >= 3';

  const [lcpFailures] = await db.query(lcpSql, lcpParams);

  if (lcpFailures.length > 0) {
    const lcpUsernames = lcpFailures.map(r => r.username);
    const placeholders = lcpUsernames.map(() => '?').join(',');

    // Get effective profile for these usernames (account-level wins over pool-level)
    const [radiusRows] = await db.query(
      `SELECT r.username,
              COALESCE(r.service_profile_id, ip.service_profile_id) AS effective_profile_id
       FROM radius r
       LEFT JOIN ip_pools ip ON ip.id = r.ipv4_pool_id
       WHERE r.username IN (${placeholders})
         AND r.deleted_at IS NULL`,
      lcpUsernames,
    );

    const profileIdsByUsername = new Map();
    for (const row of radiusRows) {
      if (row.effective_profile_id) {
        profileIdsByUsername.set(row.username, row.effective_profile_id);
      }
    }

    // Load the referenced profiles
    const profileIds = [...new Set([...profileIdsByUsername.values()])];
    if (profileIds.length > 0) {
      const ppPlaceholders = profileIds.map(() => '?').join(',');
      const [profiles] = await db.query(
        `SELECT id, name, mtu FROM pppoe_service_profiles WHERE id IN (${ppPlaceholders})`,
        profileIds,
      );
      const profileMap = new Map(profiles.map(p => [p.id, p]));

      for (const lcpRow of lcpFailures) {
        const profileId = profileIdsByUsername.get(lcpRow.username);
        if (!profileId) continue;
        const profile = profileMap.get(profileId);
        if (!profile || profile.mtu === 1492) continue;

        advisories.push({
          type: 'lcp_failure_mtu_mismatch',
          username: lcpRow.username,
          profile_id: profile.id,
          profile_name: profile.name,
          mtu: profile.mtu,
          description: `Username "${lcpRow.username}" had ${lcpRow.failure_count} LCP errors in the last 24h. `
            + `Effective profile "${profile.name}" has MTU ${profile.mtu} (not 1492). `
            + 'Note: this correlation is heuristic — LCP failures may be unrelated to MTU configuration.',
        });
      }
    }
  }

  return { advisories };
}

// ---------------------------------------------------------------------------
// Scheduled scan: scan last 15 minutes of auth failures
// ---------------------------------------------------------------------------

/**
 * Called by the scheduler (task: scan_auth_failures) every 15 minutes.
 * Scans the last 15 minutes of radpostauth for accounts exceeding the
 * auth failure threshold and emits pppoe.auth_failures events.
 *
 * Org threshold setting key: pppoe_auth_failure_threshold (default: 5).
 *
 * @param {number|null} orgId - null = all orgs
 */
async function scanAuthFailures(orgId) {
  const windowMinutes = 15;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  try {
    const { failures } = await classifyAuthFailures(orgId, since, null, null);

    // Group failures by username
    const byUsername = new Map();
    for (const f of failures) {
      if (!byUsername.has(f.username)) {
        byUsername.set(f.username, { count: 0, reasons: new Set(), organizationId: null });
      }
      const entry = byUsername.get(f.username);
      entry.count++;
      entry.reasons.add(f.reason);
    }

    // Determine threshold — try to load per-org setting
    let threshold = DEFAULT_AUTH_FAILURE_THRESHOLD;
    if (orgId) {
      try {
        const [settingRows] = await db.query(
          "SELECT value FROM settings WHERE organization_id = ? AND `key` = 'pppoe_auth_failure_threshold'",
          [orgId],
        );
        if (settingRows.length > 0) {
          const parsed = parseInt(settingRows[0].value, 10);
          if (!isNaN(parsed) && parsed > 0) threshold = parsed;
        }
      } catch (_err) {
        // fall back to default
      }
    }

    // Emit events for usernames exceeding threshold
    for (const [username, entry] of byUsername) {
      if (entry.count >= threshold) {
        // Resolve organizationId for this username if not provided
        let resolvedOrgId = orgId;
        if (!resolvedOrgId) {
          try {
            const [orgRows] = await db.query(
              'SELECT organization_id FROM radius WHERE username = ? AND deleted_at IS NULL LIMIT 1',
              [username],
            );
            if (orgRows.length > 0) resolvedOrgId = orgRows[0].organization_id;
          } catch (_err) {
            // emit with null orgId
          }
        }

        eventBus.emit('pppoe.auth_failures', {
          organizationId: resolvedOrgId,
          username,
          failureCount: entry.count,
          window_minutes: windowMinutes,
          reasons: [...entry.reasons],
        });
      }
    }

    logger.info({ orgId, scanned: failures.length, windowMinutes }, 'PPPoE auth failure scan complete');
    return { scanned: failures.length, window_minutes: windowMinutes };
  } catch (err) {
    logger.error({ err, orgId }, 'PPPoE auth failure scan error');
    throw err;
  }
}

module.exports = {
  parseRouterOsLogLine,
  classifyAuthFailures,
  detectMtuIssues,
  scanAuthFailures,
};
