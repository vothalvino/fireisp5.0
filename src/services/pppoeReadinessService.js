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

function detailMetadata(detailCode, detailParams = {}) {
  return { detailCode, detailParams };
}

function isMaintenanceMode(value) {
  return value === true || Number(value) === 1;
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
  let detailCode;
  let detailParams = {};
  if (!isolatedDatabase && embedded.enabled && !embedded.running) {
    status = 'error';
    detail = embeddedDetail(embedded, isolatedDatabase);
    detailCode = 'authentication_embedded_not_running';
  } else if (stats.events24h > 0) {
    status = 'ready';
    detail = `Post-authentication events were received in the last 24 hours. ${embeddedDetail(embedded, isolatedDatabase)}`;
    if (isolatedDatabase) {
      detailCode = 'authentication_recent_isolated';
    } else if (embedded.running) {
      detailCode = 'authentication_recent_embedded';
      detailParams = { authPort: embedded.authPort };
    } else {
      detailCode = 'authentication_recent_external';
    }
  } else if ((!isolatedDatabase && embedded.running) || stats.lastReceivedAt) {
    status = 'waiting';
    detail = `Authentication logging is available, but no events were received in the last 24 hours. ${embeddedDetail(embedded, isolatedDatabase)}`;
    if (isolatedDatabase) {
      detailCode = 'authentication_waiting_isolated';
    } else if (embedded.running) {
      detailCode = 'authentication_waiting_embedded';
      detailParams = { authPort: embedded.authPort };
    } else {
      detailCode = 'authentication_waiting_external';
    }
  } else {
    status = 'not_configured';
    detail = isolatedDatabase
      ? 'No authentication events have been received in this isolated database. Point a tenant-local external FreeRADIUS post-auth SQL feed at this database.'
      : 'No authentication events have been received. Enable embedded RADIUS or wire FreeRADIUS post-auth SQL logging.';
    detailCode = isolatedDatabase
      ? 'authentication_not_configured_isolated'
      : 'authentication_not_configured';
  }
  return { status, ...stats, detail, ...detailMetadata(detailCode, detailParams) };
}

function buildRouterSource(stats, coveredNas, totalNas, maintenanceNas = 0) {
  let status;
  let detail;
  let detailCode;
  let detailParams = {};
  const maintenanceSuffix = maintenanceNas > 0
    ? ` ${maintenanceNas} additional active NAS ${maintenanceNas === 1 ? 'is' : 'are'} excluded from automated RouterOS PPPoE diagnostics polling and readiness by maintenance mode.`
    : '';
  if (totalNas === 0 && maintenanceNas > 0) {
    status = 'not_configured';
    detail = maintenanceNas === 1
      ? 'The only active MikroTik NAS is in maintenance mode and excluded from automated RouterOS PPPoE diagnostics polling and readiness.'
      : `All ${maintenanceNas} active MikroTik NAS devices are in maintenance mode and excluded from automated RouterOS PPPoE diagnostics polling and readiness.`;
    detailCode = 'router_all_maintenance';
    detailParams = { maintenanceNas };
  } else if (totalNas === 0) {
    status = 'not_configured';
    detail = 'No active, non-maintenance MikroTik NAS devices are configured for this organization.';
    detailCode = 'router_none_active';
  } else if (coveredNas === 0) {
    status = 'not_configured';
    detail = `None of the ${totalNas} active, non-maintenance RouterOS NAS devices is configured for polling with API credentials and, when required, an active management tunnel.${maintenanceSuffix}`;
    detailCode = 'router_none_covered';
    detailParams = { totalNas, ...(maintenanceNas > 0 && { maintenanceNas }) };
  } else if (stats.events24h > 0 && coveredNas === totalNas) {
    status = 'ready';
    detail = `RouterOS events were received in the last 24 hours; all ${totalNas} active, non-maintenance NAS devices are configured for polling. Configuration coverage does not prove that every NAS succeeded in the latest poll.${maintenanceSuffix}`;
    detailCode = 'router_ready_all';
    detailParams = { totalNas, ...(maintenanceNas > 0 && { maintenanceNas }) };
  } else if (stats.events24h > 0) {
    status = 'waiting';
    detail = `RouterOS events are arriving, but only ${coveredNas} of ${totalNas} active, non-maintenance NAS devices is configured for polling.${maintenanceSuffix}`;
    detailCode = 'router_partial_coverage';
    detailParams = { coveredNas, totalNas, ...(maintenanceNas > 0 && { maintenanceNas }) };
  } else {
    status = 'waiting';
    detail = `${coveredNas} of ${totalNas} active, non-maintenance NAS devices is configured for polling; no RouterOS PPPoE event has been received in the last 24 hours.${maintenanceSuffix}`;
    detailCode = 'router_waiting_no_events';
    detailParams = { coveredNas, totalNas, ...(maintenanceNas > 0 && { maintenanceNas }) };
  }
  return {
    status,
    ...stats,
    detail,
    ...detailMetadata(detailCode, detailParams),
    coveredNas,
    totalNas,
    maintenanceNas,
  };
}

function buildAccountingSource(stats, embedded, isolatedDatabase = false) {
  const externalConfigured = !isolatedDatabase && Boolean(process.env.RADIUS_ACCOUNTING_SECRET);
  const configured = (!isolatedDatabase && embedded.enabled) || externalConfigured || Boolean(stats.lastReceivedAt);
  let status;
  let detail;
  let detailCode;
  if (stats.events24h > 0) {
    status = 'ready';
    detail = 'RADIUS accounting records were received in the last 24 hours.';
    detailCode = 'accounting_recent';
  } else if (!isolatedDatabase && embedded.enabled && !embedded.running && !externalConfigured) {
    status = 'error';
    detail = 'Embedded RADIUS accounting is enabled but the server is not running.';
    detailCode = 'accounting_embedded_not_running';
  } else if (configured) {
    status = 'waiting';
    detail = 'Accounting ingest is configured, but no records were received in the last 24 hours.';
    detailCode = 'accounting_waiting';
  } else {
    status = 'not_configured';
    detail = isolatedDatabase
      ? 'No accounting records have reached this isolated database. Use a tenant-local accounting feed; install-wide embedded and shared-secret endpoints resolve NAS devices only in the primary database.'
      : 'No accounting feed is configured. Enable embedded RADIUS or configure the shared-secret FreeRADIUS accounting endpoint.';
    detailCode = isolatedDatabase
      ? 'accounting_not_configured_isolated'
      : 'accounting_not_configured';
  }
  return { status, ...stats, detail, ...detailMetadata(detailCode) };
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
      `SELECT MAX(pel.logged_at) AS last_received_at,
              COUNT(CASE WHEN pel.logged_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) AS events_24h
         FROM pppoe_event_logs pel
         LEFT JOIN nas source_nas
           ON source_nas.id = pel.nas_id
          AND source_nas.organization_id = pel.organization_id
          AND source_nas.status = 'active'
          AND source_nas.deleted_at IS NULL
        WHERE pel.organization_id = ?
          AND (
            pel.nas_id IS NULL
            -- pppoe_event_logs intentionally has no NAS foreign key.  Keep
            -- loose-coupled/orphaned history; exclude only a positively
            -- matched, active NAS that is currently in maintenance mode.
            OR COALESCE(source_nas.maintenance_mode, 0) = 0
          )`,
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
              n.maintenance_mode,
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
  const maintenanceNas = nasRows.filter((nas) => isMaintenanceMode(nas.maintenance_mode)).length;
  const eligibleNasRows = nasRows.filter((nas) => !isMaintenanceMode(nas.maintenance_mode));
  let coveredNas = 0;
  for (const nas of eligibleNasRows) {
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
    routerEvents: buildRouterSource(
      statsFromRow(routerEventResult[0][0]),
      coveredNas,
      eligibleNasRows.length,
      maintenanceNas,
    ),
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
