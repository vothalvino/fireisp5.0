// =============================================================================
// FireISP 5.0 — RADIUS Service
// =============================================================================
// Provides RADIUS account synchronization, session management, and
// FreeRADIUS SQL integration helpers.
// =============================================================================

const db = require('../config/database');
const { sendRadiusDisconnect, sendRadiusCoA } = require('./suspensionService');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { generateAttributes } = require('./radiusAttributeService');
const { serializeLoginTime } = require('./radiusLoginTimeService');
const logger = require('../utils/logger').child({ service: 'radius' });

const BYTES_PER_GB = 1024 * 1024 * 1024;

// Circuit breaker for RADIUS CoA/Disconnect calls
const radiusCircuitBreaker = createCircuitBreaker({
  name: 'RADIUS',
  threshold: 5,
  resetMs: 60000,
});

/**
 * Synchronize a RADIUS account with its contract's current plan attributes.
 * Ensures the radius row has the correct speed/policy settings.
 */
async function syncAccount(contractId) {
  logger.info({ contractId }, 'Syncing RADIUS account');
  const [rows] = await db.query(`
    SELECT c.id AS contract_id, c.status AS contract_status,
           p.download_speed_mbps, p.upload_speed_mbps, p.name AS plan_name,
           r.id AS radius_id, r.username, r.status AS radius_status
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    LEFT JOIN radius r ON r.contract_id = c.id
    WHERE c.id = ?
  `, [contractId]);

  if (rows.length === 0) {
    return { synced: false, message: 'Contract not found' };
  }

  const row = rows[0];
  if (!row.radius_id) {
    return { synced: false, message: 'No RADIUS account for this contract' };
  }

  // Sync status: if contract is active, radius should be active; if suspended, disabled
  const expectedStatus = row.contract_status === 'active' ? 'active' : 'disabled';
  if (row.radius_status !== expectedStatus) {
    await db.query('UPDATE radius SET status = ? WHERE id = ?', [expectedStatus, row.radius_id]);
  }

  return {
    synced: true,
    contract_id: contractId,
    radius_id: row.radius_id,
    username: row.username,
    status: expectedStatus,
    plan: row.plan_name,
    download_speed: row.download_speed_mbps,
    upload_speed: row.upload_speed_mbps,
  };
}

/**
 * Bulk sync all RADIUS accounts for an organization.
 */
async function syncAllAccounts(organizationId) {
  const orgFilter = organizationId ? 'AND c.organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [contracts] = await db.query(`
    SELECT c.id FROM contracts c
    JOIN radius r ON r.contract_id = c.id
    WHERE c.status IN ('active', 'suspended') ${orgFilter}
  `, params);

  let synced = 0;
  let errors = 0;

  for (const contract of contracts) {
    try {
      await syncAccount(contract.id);
      synced++;
    } catch (_err) {
      errors++;
    }
  }

  return { synced, errors, total: contracts.length };
}

/**
 * Get the most recent active session for a contract from connection_logs.
 */
async function getActiveSession(contractId) {
  const [rows] = await db.query(`
    SELECT * FROM connection_logs
    WHERE contract_id = ? AND event_type = 'start'
      AND NOT EXISTS (
        SELECT 1 FROM connection_logs cl2
        WHERE cl2.session_id = connection_logs.session_id
          AND cl2.contract_id = connection_logs.contract_id
          AND cl2.event_type = 'stop'
      )
    ORDER BY event_at DESC LIMIT 1
  `, [contractId]);
  return rows[0] || null;
}

/**
 * Disconnect a subscriber's active session via RADIUS Disconnect-Request.
 */
async function disconnectSession(contractId) {
  return radiusCircuitBreaker.call(() => sendRadiusDisconnect(contractId));
}

/**
 * Send a RADIUS Change of Authorization for a live session.
 */
async function changeOfAuth(contractId, action) {
  return radiusCircuitBreaker.call(() => sendRadiusCoA(contractId, action || 'update'));
}

/**
 * Get session history from connection_logs.
 */
async function getSessionHistory(contractId, { from, to } = {}) {
  let sql = 'SELECT * FROM connection_logs WHERE contract_id = ?';
  const params = [contractId];

  if (from) {
    sql += ' AND event_at >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND event_at <= ?';
    params.push(to);
  }

  sql += ' ORDER BY event_at DESC LIMIT 1000';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get aggregated data usage for a contract within a time window.
 */
async function getUsageSummary(contractId, { from, to } = {}) {
  let sql = `
    SELECT
      COUNT(*) AS session_count,
      COALESCE(SUM(bytes_in), 0) AS total_bytes_in,
      COALESCE(SUM(bytes_out), 0) AS total_bytes_out,
      COALESCE(SUM(bytes_in + bytes_out), 0) AS total_bytes,
      COALESCE(SUM(session_duration), 0) AS total_duration_seconds,
      COALESCE(SUM(packets_in), 0) AS total_packets_in,
      COALESCE(SUM(packets_out), 0) AS total_packets_out
    FROM connection_logs
    WHERE contract_id = ? AND event_type IN ('stop', 'interim-update')
  `;
  const params = [contractId];

  if (from) {
    sql += ' AND event_at >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND event_at <= ?';
    params.push(to);
  }

  const [rows] = await db.query(sql, params);
  const r = rows[0];

  return {
    contract_id: contractId,
    period: { from: from || null, to: to || null },
    sessions: r.session_count,
    bytes_in: r.total_bytes_in,
    bytes_out: r.total_bytes_out,
    bytes_total: r.total_bytes,
    duration_seconds: r.total_duration_seconds,
    packets_in: r.total_packets_in,
    packets_out: r.total_packets_out,
    // Human-readable
    download_gb: parseFloat((r.total_bytes_in / BYTES_PER_GB).toFixed(3)),
    upload_gb: parseFloat((r.total_bytes_out / BYTES_PER_GB).toFixed(3)),
    total_gb: parseFloat((r.total_bytes / BYTES_PER_GB).toFixed(3)),
  };
}

// =============================================================================
// FreeRADIUS SQL Table Sync
// =============================================================================

/**
 * Normalize a MAC address to FreeRADIUS MAB convention: lowercase, no separators.
 * Input may be XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX or XXXXXXXXXXXX.
 */
function normalizeMac(mac) {
  return mac.replace(/[:.]/g, '').replace(/-/g, '').toLowerCase();
}

/**
 * Determine MAB radcheck attribute and value based on org setting.
 *
 * mab_password_mode = 'auth_type_accept' → attribute Auth-Type, op :=, value Accept
 * mab_password_mode = 'cleartext'        → attribute Cleartext-Password, op :=, value <normalized MAC>
 *
 * Default: auth_type_accept (most common FreeRADIUS MAB setup).
 */
function getMabCheckRow(normalizedMac, mabPasswordMode) {
  if (mabPasswordMode === 'cleartext') {
    return { attribute: 'Cleartext-Password', op: ':=', value: normalizedMac };
  }
  return { attribute: 'Auth-Type', op: ':=', value: 'Accept' };
}

/**
 * Derive the RADIUS group name for a plan.
 * E.g. plan ID 7, name "Basic 10M" → "plan_7"
 */
function planGroupName(planId) {
  return `plan_${planId}`;
}

/**
 * Expand vendor attribute map from radiusAttributeService into a flat array
 * of { attribute, op, value } rows suitable for radgroupreply.
 *
 * The attribute map may contain string values (one row) or arrays (multiple rows,
 * e.g. Cisco-AVPair).
 */
function expandAttributeRows(attrMap) {
  const rows = [];
  for (const [attr, val] of Object.entries(attrMap)) {
    if (Array.isArray(val)) {
      for (const v of val) {
        rows.push({ attribute: attr, op: '=', value: String(v) });
      }
    } else {
      rows.push({ attribute: attr, op: '=', value: String(val) });
    }
  }
  return rows;
}

/**
 * Synchronize the FreeRADIUS SQL tables (radcheck, radreply, radusergroup,
 * radgroupcheck, radgroupreply) from FireISP state for a given organization.
 *
 * Strategy: delete-then-reinsert per username (idempotent).
 *   • Per active subscriber → radcheck row with credential (auth-method-aware)
 *   • Per plan             → radusergroup membership + radgroupreply rows with
 *                            vendor speed attributes
 *   • For EAP-TLS          → radcheck TLS-Cert-Serial == <serial>
 *
 * @param {number|null} organizationId - scope to org; null = all orgs
 * @returns {{ synced: number, errors: number, plans_synced: number }}
 */
async function syncFreeradiusTables(organizationId) {
  logger.info({ organizationId }, 'Syncing FreeRADIUS SQL tables');

  // 1. Read org MAB password mode setting
  let mabPasswordMode = 'auth_type_accept';
  if (organizationId) {
    const [settingRows] = await db.query(
      "SELECT value FROM settings WHERE organization_id = ? AND `key` = 'mab_password_mode'",
      [organizationId],
    );
    if (settingRows.length > 0) mabPasswordMode = settingRows[0].value;
  }

  // 2. Load active subscribers (with cleartext password, auth_method, mac, plan, org)
  const orgFilter = organizationId ? 'AND r.organization_id = ?' : '';
  const orgParams = organizationId ? [organizationId] : [];

  // radius table stores cleartext password in password_hash column (historical naming)
  const [subscribers] = await db.query(
    `SELECT r.id, r.username, r.password_hash AS cleartext_password,
            r.mac_address, r.auth_method, r.organization_id,
            r.simultaneous_use AS account_sim_use,
            r.vlan_id, r.inner_vlan_id,
            c.plan_id,
            p.download_speed_mbps, p.upload_speed_mbps,
            p.burst_download_mbps, p.burst_upload_mbps,
            p.radius_vendor, p.name AS plan_name,
            p.session_timeout_seconds, p.idle_timeout_seconds,
            p.simultaneous_use AS plan_sim_use
     FROM radius r
     LEFT JOIN contracts c ON c.id = r.contract_id
     LEFT JOIN plans p ON p.id = c.plan_id
     WHERE r.status = 'active'
       AND r.deleted_at IS NULL
       ${orgFilter}`,
    orgParams,
  );

  // 3. Load active subscriber certificates for EAP-TLS
  const [certRows] = await db.query(
    `SELECT sc.radius_account_id, sc.serial_number
     FROM subscriber_certificates sc
     JOIN radius r ON r.id = sc.radius_account_id
     WHERE sc.status = 'active'
       AND sc.valid_until > NOW()
       AND r.auth_method = 'eap_tls'
       AND r.deleted_at IS NULL
       ${organizationId ? 'AND sc.organization_id = ?' : ''}`,
    organizationId ? [organizationId] : [],
  );

  // Build a map: radius_account_id → serial_number
  const certMap = new Map();
  for (const cert of certRows) {
    certMap.set(cert.radius_account_id, cert.serial_number);
  }

  // 4. Collect unique plan IDs that appear in this subscriber set
  const planSet = new Map(); // planId → plan row
  for (const sub of subscribers) {
    if (sub.plan_id && !planSet.has(sub.plan_id)) {
      planSet.set(sub.plan_id, {
        id: sub.plan_id,
        name: sub.plan_name,
        download_speed_mbps: sub.download_speed_mbps,
        upload_speed_mbps: sub.upload_speed_mbps,
        burst_download_mbps: sub.burst_download_mbps,
        burst_upload_mbps: sub.burst_upload_mbps,
        radius_vendor: sub.radius_vendor,
        session_timeout_seconds: sub.session_timeout_seconds,
        idle_timeout_seconds: sub.idle_timeout_seconds,
        simultaneous_use: sub.plan_sim_use,
      });
    }
  }

  // 4b. Load access windows for all plans in scope
  const planAccessWindowsMap = new Map(); // planId → windows[]
  if (planSet.size > 0) {
    const planIds = [...planSet.keys()];
    const placeholders = planIds.map(() => '?').join(',');
    const [windowRows] = await db.query(
      `SELECT plan_id, day_mask, start_time, end_time, status, deleted_at
       FROM plan_access_windows
       WHERE plan_id IN (${placeholders}) AND deleted_at IS NULL AND status = 'active'
       ORDER BY plan_id, id`,
      planIds,
    );
    for (const row of windowRows) {
      if (!planAccessWindowsMap.has(row.plan_id)) {
        planAccessWindowsMap.set(row.plan_id, []);
      }
      planAccessWindowsMap.get(row.plan_id).push(row);
    }
  }

  // 4c. Load per-account routes for all active subscribers
  const subscriberIds = subscribers.map(s => s.id);
  const routeMap = new Map(); // radius_account_id → routes[]
  if (subscriberIds.length > 0) {
    const placeholders = subscriberIds.map(() => '?').join(',');
    const [routeRows] = await db.query(
      `SELECT radius_account_id, destination, gateway, metric
       FROM radius_account_routes
       WHERE radius_account_id IN (${placeholders}) AND deleted_at IS NULL
       ORDER BY radius_account_id, id`,
      subscriberIds,
    );
    for (const row of routeRows) {
      if (!routeMap.has(row.radius_account_id)) {
        routeMap.set(row.radius_account_id, []);
      }
      routeMap.get(row.radius_account_id).push(row);
    }
  }

  // 4d. Load walled garden settings for this org (for walled_garden suspension check)
  let walledGardenAddressListName = 'walled_garden';
  if (organizationId) {
    const [wgRows] = await db.query(
      'SELECT address_list_name FROM organization_walled_garden_settings WHERE organization_id = ? AND enabled = 1',
      [organizationId],
    );
    if (wgRows.length > 0) walledGardenAddressListName = wgRows[0].address_list_name;
  }

  // 4e. Load subscribers who are currently walled (active walled_garden suspension_log)
  const walledUsernames = new Set();
  if (organizationId) {
    const [walledRows] = await db.query(
      `SELECT r.username
       FROM suspension_logs sl
       JOIN contracts ct ON ct.id = sl.contract_id
       JOIN radius r ON r.contract_id = ct.id
       WHERE ct.organization_id = ?
         AND sl.action = 'walled_garden'
         AND sl.restored_at IS NULL
         AND r.status = 'active'
         AND r.deleted_at IS NULL`,
      [organizationId],
    );
    for (const row of walledRows) walledUsernames.add(row.username);
  }

  let synced = 0;
  let errors = 0;

  // 5. Sync per-subscriber rows: delete existing radcheck + radusergroup, rewrite
  for (const sub of subscribers) {
    try {
      const username = sub.username;

      // Delete existing rows for this username
      await db.query('DELETE FROM radcheck WHERE username = ?', [username]);
      await db.query('DELETE FROM radreply WHERE username = ?', [username]);
      await db.query('DELETE FROM radusergroup WHERE username = ?', [username]);

      if (sub.auth_method === 'mac') {
        // MAB: username is the normalized MAC; credential depends on mabPasswordMode
        if (!sub.mac_address) {
          logger.warn({ radiusId: sub.id }, 'MAB account missing mac_address — skipping');
          errors++;
          continue;
        }
        const normalizedMac = normalizeMac(sub.mac_address);
        const checkRow = getMabCheckRow(normalizedMac, mabPasswordMode);
        await db.query(
          'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
          [username, checkRow.attribute, checkRow.op, checkRow.value],
        );
      } else {
        // pppoe / dot1x / eap_tls: Cleartext-Password
        await db.query(
          'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
          [username, 'Cleartext-Password', ':=', sub.cleartext_password],
        );

        // EAP-TLS: add TLS-Cert-Serial check entry if certificate available
        if (sub.auth_method === 'eap_tls' && certMap.has(sub.id)) {
          await db.query(
            'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
            [username, 'TLS-Cert-Serial', '==', certMap.get(sub.id)],
          );
        }
      }

      // Item 11: Simultaneous-Use check — account override wins over plan default
      const simUse = sub.account_sim_use !== null && sub.account_sim_use !== undefined ? sub.account_sim_use : (sub.plan_sim_use ?? 1);
      await db.query(
        'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
        [username, 'Simultaneous-Use', ':=', String(simUse)],
      );

      // Item 13: VLAN assignment via RADIUS — per-user radreply tunnel attributes
      if (sub.vlan_id) {
        await db.query(
          'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
          [username, 'Tunnel-Type', ':=', 'VLAN'],
        );
        await db.query(
          'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
          [username, 'Tunnel-Medium-Type', ':=', 'IEEE-802'],
        );
        await db.query(
          'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
          [username, 'Tunnel-Private-Group-Id', ':=', String(sub.vlan_id)],
        );
        // QinQ: inner VLAN uses tag 1 convention (Tunnel-Private-Group-Id:1)
        if (sub.inner_vlan_id) {
          await db.query(
            'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
            [username, 'Tunnel-Private-Group-Id:1', ':=', String(sub.inner_vlan_id)],
          );
        }
      }

      // Item 14: Walled garden — emit Mikrotik-Address-List if subscriber is walled
      if (walledUsernames.has(username)) {
        await db.query(
          'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
          [username, 'Mikrotik-Address-List', ':=', walledGardenAddressListName],
        );
      }

      // Item 15: Framed-Route per-account route injection
      const routes = routeMap.get(sub.id) || [];
      for (const route of routes) {
        // Format: "<dest> <gw> <metric>" omitting optional fields when null
        let routeValue = route.destination;
        if (route.gateway) routeValue += ` ${route.gateway}`;
        if (route.metric !== null && route.metric !== undefined) routeValue += ` ${route.metric}`;
        await db.query(
          'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)',
          [username, 'Framed-Route', '+=', routeValue],
        );
      }

      // Map user to plan group (if plan is known)
      if (sub.plan_id) {
        const group = planGroupName(sub.plan_id);
        await db.query(
          'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
          [username, group],
        );
      }

      synced++;
    } catch (err) {
      logger.error({ err, username: sub.username }, 'Error syncing FreeRADIUS rows for subscriber');
      errors++;
    }
  }

  // 6. Sync plan-level group rows: delete existing, rewrite
  for (const [planId, plan] of planSet) {
    try {
      const group = planGroupName(planId);

      await db.query('DELETE FROM radgroupcheck WHERE groupname = ?', [group]);
      await db.query('DELETE FROM radgroupreply WHERE groupname = ?', [group]);

      // Generate vendor-specific RADIUS reply attributes for this plan (speed policy)
      const attrMap = generateAttributes(plan);
      const attrRows = expandAttributeRows(attrMap);

      for (const row of attrRows) {
        await db.query(
          'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [group, row.attribute, row.op, row.value],
        );
      }

      // Item 10: Session-Timeout and Idle-Timeout
      if (plan.session_timeout_seconds !== null && plan.session_timeout_seconds !== undefined) {
        await db.query(
          'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [group, 'Session-Timeout', ':=', String(plan.session_timeout_seconds)],
        );
      }
      if (plan.idle_timeout_seconds !== null && plan.idle_timeout_seconds !== undefined) {
        await db.query(
          'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [group, 'Idle-Timeout', ':=', String(plan.idle_timeout_seconds)],
        );
      }

      // Item 12: Login-Time from plan_access_windows
      const accessWindows = planAccessWindowsMap.get(planId) || [];
      const loginTime = serializeLoginTime(accessWindows);
      if (loginTime) {
        await db.query(
          'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [group, 'Login-Time', ':=', loginTime],
        );
      }
    } catch (err) {
      logger.error({ err, planId }, 'Error syncing FreeRADIUS group rows for plan');
    }
  }

  logger.info(
    { synced, errors, plans_synced: planSet.size, organizationId },
    'FreeRADIUS SQL table sync complete',
  );

  return { synced, errors, plans_synced: planSet.size };
}

// =============================================================================
// Duplicate Session Enforcement (item 11)
// =============================================================================

/**
 * Find subscribers with more active sessions in connection_logs than their
 * allowed simultaneous_use limit, then disconnect the oldest excess sessions.
 *
 * "Active session" = a connection_logs row with event_type='start' that has no
 * matching 'stop' row for the same session_id.
 *
 * The oldest sessions (lowest id / earliest event_at) are kicked first.
 *
 * @param {number|null} organizationId - scope to org; null = all orgs
 * @returns {{ kicked: number, errors: number }}
 */
async function kickDuplicateSessions(organizationId) {
  logger.info({ organizationId }, 'Checking for duplicate sessions to kick');

  const orgFilter = organizationId ? 'AND r.organization_id = ?' : '';
  const orgParams = organizationId ? [organizationId] : [];

  // Load all active subscribers with their effective simultaneous_use limit
  const [subscribers] = await db.query(
    `SELECT r.id AS radius_id, r.username,
            COALESCE(r.simultaneous_use, p.simultaneous_use, 1) AS allowed_sim_use,
            n.ip_address AS nas_ip, n.coa_port, n.secret AS nas_secret,
            r.contract_id
     FROM radius r
     LEFT JOIN contracts c ON c.id = r.contract_id
     LEFT JOIN plans p ON p.id = c.plan_id
     LEFT JOIN nas n ON n.id = r.nas_id
     WHERE r.status = 'active'
       AND r.deleted_at IS NULL
       ${orgFilter}`,
    orgParams,
  );

  let kicked = 0;
  let errors = 0;

  for (const sub of subscribers) {
    try {
      // Find all active sessions for this username (start with no stop)
      const [activeSessions] = await db.query(
        `SELECT cl.id, cl.session_id, cl.nas_ip_address, cl.event_at
         FROM connection_logs cl
         WHERE cl.username = ?
           AND cl.event_type = 'start'
           AND NOT EXISTS (
             SELECT 1 FROM connection_logs cl2
             WHERE cl2.session_id = cl.session_id
               AND cl2.username = cl.username
               AND cl2.event_type = 'stop'
           )
         ORDER BY cl.event_at ASC, cl.id ASC`,
        [sub.username],
      );

      const excess = activeSessions.length - sub.allowed_sim_use;
      if (excess <= 0) continue;

      // Disconnect the oldest `excess` sessions
      const toKick = activeSessions.slice(0, excess);
      for (const session of toKick) {
        try {
          const result = await radiusCircuitBreaker.call(
            () => sendRadiusDisconnect(sub.contract_id),
          );
          logger.info(
            { username: sub.username, session_id: session.session_id, result },
            'Kicked duplicate session',
          );
          kicked++;
        } catch (kickErr) {
          logger.error({ err: kickErr, username: sub.username }, 'Failed to kick duplicate session');
          errors++;
        }
      }
    } catch (err) {
      logger.error({ err, username: sub.username }, 'Error processing duplicate session check');
      errors++;
    }
  }

  logger.info({ kicked, errors, organizationId }, 'Duplicate session kick complete');
  return { kicked, errors };
}

// =============================================================================
// Walled Garden Suspension (item 14)
// =============================================================================

/**
 * Place a subscriber into the walled garden by sending CoA with
 * Mikrotik-Address-List attribute and logging a walled_garden suspension event.
 *
 * @param {number} contractId
 * @param {number} ruleId
 * @param {number|null} userId
 * @param {number|null} invoiceId
 * @returns {Promise<{skipped?: boolean, reason?: string}>}
 */
async function walledGardenSuspendContract(contractId, ruleId, userId, invoiceId) {
  // Check suspension exempt
  const { isClientSuspensionExempt } = require('./suspensionService');
  const exemptCheck = await isClientSuspensionExempt(contractId);
  if (exemptCheck.exempt) {
    logger.info({ contractId, reason: exemptCheck.reason }, 'Skipping walled garden — client exempt');
    return { skipped: true, reason: exemptCheck.reason };
  }

  logger.info({ contractId, ruleId, invoiceId }, 'Applying walled garden suspension');

  let coaSent = false;
  let coaResponse;
  try {
    const coaResult = await sendRadiusCoA(contractId, 'walled_garden');
    coaSent = coaResult.sent;
    coaResponse = JSON.stringify({ action: 'walled_garden', result: coaResult.response });
  } catch (_err) {
    coaResponse = JSON.stringify({ action: 'walled_garden', result: 'CoA send failed' });
  }

  await db.query(
    `INSERT INTO suspension_logs (contract_id, suspension_rule_id, action, performed_by, invoice_id, coa_sent, coa_response, suspended_at)
     VALUES (?, ?, 'walled_garden', ?, ?, ?, ?, NOW())`,
    [contractId, ruleId, userId, invoiceId, coaSent, coaResponse],
  );

  // Trigger a FreeRADIUS sync so re-auth picks up the walled attribute immediately
  const [radiusRows] = await db.query(
    'SELECT organization_id FROM radius WHERE contract_id = ? LIMIT 1',
    [contractId],
  );
  if (radiusRows.length > 0) {
    await syncFreeradiusTables(radiusRows[0].organization_id).catch(() => {});
  }
}

/**
 * Remove a subscriber from the walled garden (mark the suspension_log restored,
 * send CoA reconnect, and re-sync so the Mikrotik-Address-List row is removed).
 *
 * @param {number} contractId
 * @param {number|null} userId
 */
async function walledGardenReconnect(contractId, _userId) {
  logger.info({ contractId }, 'Removing walled garden restriction');

  // Mark any open walled_garden suspension logs as restored
  await db.query(
    `UPDATE suspension_logs SET restored_at = NOW()
     WHERE contract_id = ? AND action = 'walled_garden' AND restored_at IS NULL`,
    [contractId],
  );

  try {
    await sendRadiusCoA(contractId, 'walled_garden_remove');
  } catch (_err) {
    // CoA failure non-fatal — sync will remove the attribute on next run
  }

  // Trigger immediate sync so re-auth no longer gets walled attribute
  const [radiusRows] = await db.query(
    'SELECT organization_id FROM radius WHERE contract_id = ? LIMIT 1',
    [contractId],
  );
  if (radiusRows.length > 0) {
    await syncFreeradiusTables(radiusRows[0].organization_id).catch(() => {});
  }
}

/**
 * Check for subscriber_certificates expiring within 30 days.
 * Returns a summary; notification integration can be wired here in future.
 *
 * @param {number|null} organizationId
 */
async function checkCertificateExpiry(organizationId) {
  const orgFilter = organizationId ? 'AND organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];

  const [expiring] = await db.query(
    `SELECT id, common_name, serial_number, valid_until, status, organization_id
     FROM subscriber_certificates
     WHERE status = 'active'
       AND valid_until <= DATE_ADD(NOW(), INTERVAL 30 DAY)
       ${orgFilter}`,
    params,
  );

  if (expiring.length > 0) {
    logger.warn(
      { count: expiring.length, organizationId },
      'Subscriber certificates expiring within 30 days',
    );
  }

  return {
    expiring_soon: expiring.length,
    certificates: expiring.map(c => ({
      id: c.id,
      common_name: c.common_name,
      serial_number: c.serial_number,
      valid_until: c.valid_until,
    })),
  };
}

module.exports = {
  syncAccount,
  syncAllAccounts,
  syncFreeradiusTables,
  checkCertificateExpiry,
  getActiveSession,
  disconnectSession,
  changeOfAuth,
  getSessionHistory,
  getUsageSummary,
  kickDuplicateSessions,
  walledGardenSuspendContract,
  walledGardenReconnect,
  radiusCircuitBreaker,
};
