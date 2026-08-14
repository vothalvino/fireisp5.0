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

function normalizePostAuthReason(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

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
 * Tenant scoping is performed directly on radpostauth.organization_id.  A
 * username-only correlation is unsafe because separate organizations may use
 * the same subscriber name.  Rows written before migration 455 have NULL
 * ownership and are therefore visible only to an unscoped/global scan.
 *
 * Failure reasons:
 *   bad_password   — explicit embedded-server reason, or a legacy rejection for
 *                    a live subscriber in the same organization
 *   unknown_user   — explicit unknown/inactive reason, or a legacy rejection
 *                    without a same-organization live subscriber
 *   session_limit  — reply contains 'simultaneous' (case-insensitive)
 *   no_pool        — reply contains 'no free' or 'no pool' heuristic
 *   other          — malformed/unsupported/not-configured and unknown reasons
 *
 * @param {number|null} orgId
 * @param {Date|string|null} since
 * @param {Date|string|null} until
 * @param {string|null} [username]
 * @param {{ excludeIsolatedTenants?: boolean }} [options]
 * @returns {Promise<{ failures: object[], counts: object, total: number }>}
 */
async function classifyAuthFailures(orgId, since, until, username, options = {}) {
  const { excludeIsolatedTenants = false } = options;
  let sql = `
    SELECT rpa.organization_id, rpa.nas_id, rpa.username, rpa.authdate,
           rpa.nas_ip_address, rpa.calling_station_id, rpa.reply,
           rpa.reason_code
    FROM radpostauth rpa
    WHERE (
      (NULLIF(TRIM(rpa.reason_code), '') IS NULL
       AND rpa.reply NOT LIKE 'Access-Accept%')
      OR
      (NULLIF(TRIM(rpa.reason_code), '') IS NOT NULL
       AND LOWER(TRIM(rpa.reason_code)) <> 'accepted')
    )
  `;
  const params = [];

  if (orgId !== null && orgId !== undefined) {
    sql += ' AND rpa.organization_id = ?';
    params.push(orgId);
  }
  if (excludeIsolatedTenants) {
    // A tenant's historical rows can remain in the primary database after it
    // switches to an isolated database. The global primary sweep must leave
    // those rows to the isolated-database pass or it could alert twice.
    sql += ` AND NOT EXISTS (
      SELECT 1
        FROM organization_database_configs odc
       WHERE odc.organization_id = rpa.organization_id
         AND odc.isolation_mode = 'isolated'
    )`;
  }
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

  sql += ' ORDER BY rpa.authdate DESC LIMIT 1000';

  const [rejectedRows] = await db.query(sql, params);

  if (rejectedRows.length === 0) {
    return {
      failures: [],
      counts: { bad_password: 0, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 },
      total: 0,
    };
  }

  // Only legacy rows need subscriber inference.  Match both organization and
  // username; using radcheck here would reintroduce a username-only tenant
  // collision because the standard FreeRADIUS table has no organization_id.
  const legacyUsernames = [...new Set(rejectedRows
    .filter(row => !normalizePostAuthReason(row.reason_code) && row.username)
    .map(row => row.username))];
  const knownUsers = new Set();
  if (legacyUsernames.length > 0) {
    let subscriberSql = `
      SELECT DISTINCT username, organization_id
        FROM radius
       WHERE deleted_at IS NULL
         AND status = 'active'
    `;
    const subscriberParams = [];
    if (orgId !== null && orgId !== undefined) {
      subscriberSql += ' AND organization_id = ?';
      subscriberParams.push(orgId);
    }
    subscriberSql += ` AND username IN (${legacyUsernames.map(() => '?').join(', ')})`;
    subscriberParams.push(...legacyUsernames);

    const [subscriberRows] = await db.query(subscriberSql, subscriberParams);
    for (const row of subscriberRows) {
      knownUsers.add(`${row.organization_id ?? 'null'}\u0000${row.username}`);
    }
  }

  const counts = { bad_password: 0, unknown_user: 0, session_limit: 0, no_pool: 0, other: 0 };
  const failures = [];

  for (const row of rejectedRows) {
    let reason;
    const explicitReason = normalizePostAuthReason(row.reason_code);

    if (explicitReason === 'bad_password') {
      reason = 'bad_password';
    } else if (explicitReason === 'unknown_or_inactive_user') {
      reason = 'unknown_user';
    } else if (explicitReason === 'session_limit') {
      reason = 'session_limit';
    } else if (explicitReason === 'no_pool') {
      reason = 'no_pool';
    } else if (explicitReason) {
      // missing_username, password_not_configured,
      // unsupported_auth_method, or a future producer-specific code.
      reason = 'other';
    } else if (/simultaneous/i.test(row.reply || '')) {
      reason = 'session_limit';
    } else if (/no free|no pool/i.test(row.reply || '')) {
      reason = 'no_pool';
    } else if (knownUsers.has(`${row.organization_id ?? 'null'}\u0000${row.username}`)) {
      reason = 'bad_password';
    } else {
      reason = 'unknown_user';
    }

    counts[reason]++;
    failures.push({
      username: row.username,
      organization_id: row.organization_id ?? null,
      nas_id: row.nas_id ?? null,
      authdate: row.authdate,
      nas_ip_address: row.nas_ip_address,
      calling_station_id: row.calling_station_id,
      reason,
      reason_code: explicitReason,
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
  if (orgId !== null && orgId !== undefined) {
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
    SELECT organization_id, username, COUNT(*) AS failure_count
    FROM pppoe_event_logs
    WHERE stage = 'LCP'
      AND severity = 'error'
      AND logged_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND username IS NOT NULL
  `;
  const lcpParams = [];
  if (orgId !== null && orgId !== undefined) {
    lcpSql += ' AND organization_id = ?';
    lcpParams.push(orgId);
  }
  lcpSql += ' GROUP BY organization_id, username HAVING COUNT(*) >= 3';

  const [lcpFailures] = await db.query(lcpSql, lcpParams);

  if (lcpFailures.length > 0) {
    const lcpUsernames = [...new Set(lcpFailures.map(r => r.username))];
    const placeholders = lcpUsernames.map(() => '?').join(',');

    // Get effective profile for these usernames (account-level wins over pool-level)
    let radiusSql = `
      SELECT r.organization_id, r.username,
             COALESCE(r.service_profile_id, ip.service_profile_id) AS effective_profile_id
        FROM radius r
        LEFT JOIN ip_pools ip
          ON ip.id = r.ipv4_pool_id
         AND ip.organization_id <=> r.organization_id
       WHERE r.username IN (${placeholders})
         AND r.deleted_at IS NULL
    `;
    const radiusParams = [...lcpUsernames];
    if (orgId !== null && orgId !== undefined) {
      radiusSql += ' AND r.organization_id = ?';
      radiusParams.push(orgId);
    }
    const [radiusRows] = await db.query(radiusSql, radiusParams);

    const profileIdsByUsername = new Map();
    for (const row of radiusRows) {
      if (row.effective_profile_id) {
        const rowOrgId = row.organization_id ?? orgId ?? null;
        profileIdsByUsername.set(`${rowOrgId ?? 'null'}\u0000${row.username}`, row.effective_profile_id);
      }
    }

    // Load the referenced profiles
    const profileIds = [...new Set([...profileIdsByUsername.values()])];
    if (profileIds.length > 0) {
      const ppPlaceholders = profileIds.map(() => '?').join(',');
      let referencedProfileSql = `
        SELECT id, organization_id, name, mtu
          FROM pppoe_service_profiles
         WHERE id IN (${ppPlaceholders})
      `;
      const referencedProfileParams = [...profileIds];
      if (orgId !== null && orgId !== undefined) {
        referencedProfileSql += ' AND organization_id = ?';
        referencedProfileParams.push(orgId);
      }
      const [profiles] = await db.query(referencedProfileSql, referencedProfileParams);
      const profileMap = new Map(profiles.map(p => [p.id, p]));

      for (const lcpRow of lcpFailures) {
        const rowOrgId = lcpRow.organization_id ?? orgId ?? null;
        const profileId = profileIdsByUsername.get(`${rowOrgId ?? 'null'}\u0000${lcpRow.username}`);
        if (!profileId) continue;
        const profile = profileMap.get(profileId);
        const profileOrgId = profile?.organization_id ?? orgId ?? null;
        if (!profile || profileOrgId !== rowOrgId || profile.mtu === 1492) continue;

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

/** Scan one selected database context and emit tenant-owned threshold events. */
async function scanCurrentDatabase(orgId, since, excludeIsolatedTenants = false) {
  const windowMinutes = 15;
  const { failures } = await classifyAuthFailures(
    orgId,
    since,
    null,
    null,
    { excludeIsolatedTenants },
  );

  // Group failures by tenant + username.  Subscriber names are not globally
  // unique and a global scheduled scan must never combine two ISPs' counts.
  const byUsername = new Map();
  for (const f of failures) {
    const resolvedOrgId = f.organization_id ?? orgId ?? null;
    // Legacy rows without tenant ownership cannot be routed safely to an
    // organization notification channel. They remain available to an
    // explicitly unscoped diagnostic inspection, but never raise alerts.
    if (resolvedOrgId === null || resolvedOrgId === undefined) continue;
    const tenantUsername = `${resolvedOrgId ?? 'null'}\u0000${f.username}`;
    if (!byUsername.has(tenantUsername)) {
      byUsername.set(tenantUsername, {
        username: f.username,
        count: 0,
        reasons: new Set(),
        organizationId: resolvedOrgId,
      });
    }
    const entry = byUsername.get(tenantUsername);
    entry.count++;
    entry.reasons.add(f.reason);
  }

  // One query for every org in play, rather than one per username.
  const thresholdByOrg = new Map();
  const orgsInPlay = [...new Set([...byUsername.values()]
    .map(entry => entry.organizationId)
    .filter(organizationId => organizationId !== null && organizationId !== undefined))];
  if (orgsInPlay.length > 0) {
    try {
      const [settingRows] = await db.query(
        `SELECT organization_id, setting_value FROM organization_settings
          WHERE setting_key = 'pppoe_auth_failure_threshold'
            AND organization_id IN (${orgsInPlay.map(() => '?').join(', ')})`,
        orgsInPlay,
      );
      for (const row of settingRows) {
        const parsed = parseInt(row.setting_value, 10);
        if (!isNaN(parsed) && parsed > 0) thresholdByOrg.set(row.organization_id, parsed);
      }
    } catch (_err) {
      // fall back to the default for every org
    }
  }

  // Emit events for usernames exceeding THEIR org's threshold. The event
  // contract is unchanged so downstream alert/webhook dedupe remains stable.
  for (const entry of byUsername.values()) {
    const threshold = thresholdByOrg.get(entry.organizationId) ?? DEFAULT_AUTH_FAILURE_THRESHOLD;
    if (entry.count >= threshold) {
      eventBus.emit('pppoe.auth_failures', {
        organizationId: entry.organizationId,
        username: entry.username,
        failureCount: entry.count,
        window_minutes: windowMinutes,
        reasons: [...entry.reasons],
      });
    }
  }

  logger.info({ orgId, scanned: failures.length, windowMinutes }, 'PPPoE auth failure database scan complete');
  return { scanned: failures.length, window_minutes: windowMinutes };
}

/**
 * Called by the scheduler (task: scan_auth_failures) every 15 minutes. Scans
 * the requested tenant or fans a global task out over every supported database
 * context. Shared tenants are scanned together on the primary DB; each active
 * isolated tenant is then scanned in its own context. A failed database scope
 * is recorded without preventing the remaining scopes.
 *
 * Org threshold setting key: pppoe_auth_failure_threshold (default: 5).
 *
 * @param {number|null} orgId - null = all orgs
 */
async function scanAuthFailures(orgId) {
  const windowMinutes = 15;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  if (orgId !== null && orgId !== undefined) {
    try {
      return await db.withTenantContext(
        orgId,
        () => scanCurrentDatabase(orgId, since),
      );
    } catch (err) {
      logger.error({ err, orgId }, 'PPPoE auth failure scan error');
      throw err;
    }
  }

  let isolatedOrganizationIds;
  try {
    isolatedOrganizationIds = await db.withPrimaryContext(async () => {
      const [rows] = await db.query(
        `SELECT odc.organization_id
           FROM organization_database_configs odc
           JOIN organizations o ON o.id = odc.organization_id
          WHERE odc.isolation_mode = 'isolated'
            AND o.status = 'active'
            AND o.deleted_at IS NULL
          ORDER BY odc.organization_id`,
      );
      return rows.map(row => row.organization_id);
    });
  } catch (err) {
    logger.error({ err, orgId: null }, 'PPPoE auth failure database-scope discovery failed');
    throw err;
  }

  const summary = {
    scanned: 0,
    window_minutes: windowMinutes,
    database_scopes_total: 1 + isolatedOrganizationIds.length,
    database_scopes_succeeded: 0,
    database_scopes_failed: 0,
    failures: [],
  };

  try {
    const primary = await db.withPrimaryContext(
      () => scanCurrentDatabase(null, since, true),
    );
    summary.scanned += primary.scanned;
    summary.database_scopes_succeeded += 1;
  } catch (err) {
    summary.database_scopes_failed += 1;
    summary.failures.push({ organizationId: null, message: err.message });
    logger.warn({ err: err.message }, 'Primary PPPoE auth failure sweep failed; continuing with isolated tenants');
  }

  for (const isolatedOrganizationId of isolatedOrganizationIds) {
    try {
      const tenant = await db.withTenantContext(
        isolatedOrganizationId,
        () => scanCurrentDatabase(isolatedOrganizationId, since),
      );
      summary.scanned += tenant.scanned;
      summary.database_scopes_succeeded += 1;
    } catch (err) {
      summary.database_scopes_failed += 1;
      summary.failures.push({ organizationId: isolatedOrganizationId, message: err.message });
      logger.warn(
        { err: err.message, organizationId: isolatedOrganizationId },
        'Isolated-tenant PPPoE auth failure sweep failed; continuing',
      );
    }
  }

  logger.info(summary, 'Global PPPoE auth failure scan complete');
  return summary;
}

module.exports = {
  parseRouterOsLogLine,
  classifyAuthFailures,
  detectMtuIssues,
  scanAuthFailures,
};
