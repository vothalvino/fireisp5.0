// =============================================================================
// FireISP 5.0 — PPPoE diagnostics source readiness
// =============================================================================

const db = require('../config/database');
const radiusServerService = require('./radiusServerService');
const routerProvisioningService = require('./routerProvisioningService');

function toIsoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statsFromRow(row = {}) {
  return {
    lastReceivedAt: toIsoOrNull(row.last_received_at),
    events24h: Number(row.events_24h || 0),
  };
}

function embeddedDetail(status, isolatedDatabase = false) {
  if (isolatedDatabase) {
    return 'This organization uses an isolated database; use tenant-local external FreeRADIUS telemetry instead of the install-wide embedded listener.';
  }
  if (!status.enabled) return 'Embedded RADIUS is disabled; an external FreeRADIUS post-auth feed may be used.';
  if (!status.running) return 'Embedded RADIUS is enabled but is not running.';
  return `Embedded RADIUS is running on authentication port ${status.authPort}.`;
}

function buildAuthenticationSource(stats, embedded, isolatedDatabase = false) {
  let status;
  let detail;
  if (!isolatedDatabase && embedded.enabled && !embedded.running) {
    status = 'error';
    detail = embeddedDetail(embedded, isolatedDatabase);
  } else if (stats.events24h > 0) {
    status = 'ready';
    detail = `Post-authentication events were received in the last 24 hours. ${embeddedDetail(embedded, isolatedDatabase)}`;
  } else if ((!isolatedDatabase && embedded.running) || stats.lastReceivedAt) {
    status = 'waiting';
    detail = `Authentication logging is available, but no events were received in the last 24 hours. ${embeddedDetail(embedded, isolatedDatabase)}`;
  } else {
    status = 'not_configured';
    detail = isolatedDatabase
      ? 'No authentication events have been received in this isolated database. Point a tenant-local external FreeRADIUS post-auth SQL feed at this database.'
      : 'No authentication events have been received. Enable embedded RADIUS or wire FreeRADIUS post-auth SQL logging.';
  }
  return { status, ...stats, detail };
}

function buildRouterSource(stats, coveredNas, totalNas) {
  let status;
  let detail;
  if (totalNas === 0) {
    status = 'not_configured';
    detail = 'No active MikroTik NAS devices are configured for this organization.';
  } else if (coveredNas === 0) {
    status = 'not_configured';
    detail = `None of the ${totalNas} active RouterOS NAS devices is configured for polling with API credentials and, when required, an active management tunnel.`;
  } else if (stats.events24h > 0 && coveredNas === totalNas) {
    status = 'ready';
    detail = `RouterOS events were received in the last 24 hours; all ${totalNas} active NAS devices are configured for polling. Configuration coverage does not prove that every NAS succeeded in the latest poll.`;
  } else if (stats.events24h > 0) {
    status = 'waiting';
    detail = `RouterOS events are arriving, but only ${coveredNas} of ${totalNas} active NAS devices is configured for polling.`;
  } else {
    status = 'waiting';
    detail = `${coveredNas} of ${totalNas} active NAS devices is configured for polling; no RouterOS PPPoE event has been received in the last 24 hours.`;
  }
  return { status, ...stats, detail, coveredNas, totalNas };
}

function buildAccountingSource(stats, embedded, isolatedDatabase = false) {
  const externalConfigured = !isolatedDatabase && Boolean(process.env.RADIUS_ACCOUNTING_SECRET);
  const configured = (!isolatedDatabase && embedded.enabled) || externalConfigured || Boolean(stats.lastReceivedAt);
  let status;
  let detail;
  if (stats.events24h > 0) {
    status = 'ready';
    detail = 'RADIUS accounting records were received in the last 24 hours.';
  } else if (!isolatedDatabase && embedded.enabled && !embedded.running && !externalConfigured) {
    status = 'error';
    detail = 'Embedded RADIUS accounting is enabled but the server is not running.';
  } else if (configured) {
    status = 'waiting';
    detail = 'Accounting ingest is configured, but no records were received in the last 24 hours.';
  } else {
    status = 'not_configured';
    detail = isolatedDatabase
      ? 'No accounting records have reached this isolated database. Use a tenant-local accounting feed; install-wide embedded and shared-secret endpoints resolve NAS devices only in the primary database.'
      : 'No accounting feed is configured. Enable embedded RADIUS or configure the shared-secret FreeRADIUS accounting endpoint.';
  }
  return { status, ...stats, detail };
}

function overallStatus(sources) {
  const statuses = Object.values(sources).map((source) => source.status);
  if (statuses.every((status) => status === 'ready')) return 'ready';
  if (statuses.every((status) => status === 'not_configured')) return 'not_configured';
  return 'partial';
}

/** Return tenant-safe readiness for the three telemetry sources behind the UI. */
async function getReadiness(organizationId) {
  const isolationPromise = typeof db.getTenantConnectionConfig === 'function'
    ? db.getTenantConnectionConfig(organizationId).then(Boolean)
    : Promise.resolve(false);
  const [authResult, routerEventResult, accountingResult, nasResult, isolatedDatabase] = await Promise.all([
    db.query(
      `SELECT MAX(authdate) AS last_received_at,
              COUNT(CASE WHEN authdate >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) AS events_24h
         FROM radpostauth
        WHERE organization_id = ?`,
      [organizationId],
    ),
    db.query(
      `SELECT MAX(logged_at) AS last_received_at,
              COUNT(CASE WHEN logged_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) AS events_24h
         FROM pppoe_event_logs
        WHERE organization_id = ?`,
      [organizationId],
    ),
    db.query(
      `SELECT MAX(cl.event_at) AS last_received_at,
              COUNT(CASE WHEN cl.event_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) AS events_24h
         FROM connection_logs cl
         JOIN nas n ON n.id = cl.nas_id
        WHERE n.organization_id = ?`,
      [organizationId],
    ),
    db.query(
      `SELECT n.id, n.ip_address, n.api_port, n.api_username,
              n.api_password_encrypted, n.api_use_tls, n.access_mode,
              wg.id AS wg_tunnel_id, wg.state AS wg_state,
              wg.server_peer_synced AS wg_server_peer_synced
         FROM nas n
         LEFT JOIN nas_wg_tunnels wg
           ON wg.nas_id = n.id AND wg.deleted_at IS NULL
        WHERE n.organization_id = ?
          AND n.status = 'active'
          AND n.deleted_at IS NULL
          AND LOWER(n.type) = 'mikrotik'
        ORDER BY n.id`,
      [organizationId],
    ),
    isolationPromise,
  ]);

  const embedded = radiusServerService.getStatus();
  const nasRows = nasResult[0];
  let coveredNas = 0;
  for (const nas of nasRows) {
    if (!nas.api_username || !nas.api_password_encrypted) continue;
    if (nas.access_mode === 'nated'
        && (!nas.wg_tunnel_id
          || !['active', 'manual'].includes(nas.wg_state)
          || !nas.wg_server_peer_synced)) continue;
    try {
      routerProvisioningService.nasToConn(nas);
      coveredNas += 1;
    } catch {
      // Invalid/incomplete credentials do not count as diagnostic coverage.
    }
  }

  const sources = {
    authentication: buildAuthenticationSource(statsFromRow(authResult[0][0]), embedded, isolatedDatabase),
    routerEvents: buildRouterSource(statsFromRow(routerEventResult[0][0]), coveredNas, nasRows.length),
    accounting: buildAccountingSource(statsFromRow(accountingResult[0][0]), embedded, isolatedDatabase),
  };

  return { overall: overallStatus(sources), sources };
}

module.exports = {
  getReadiness,
  overallStatus,
  // Exported for focused unit tests.
  buildAuthenticationSource,
  buildRouterSource,
  buildAccountingSource,
};
