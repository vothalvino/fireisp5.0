// =============================================================================
// FireISP 5.0 — session and privacy-minimal IP-attribution readiness
// =============================================================================

const db = require('../config/database');
const config = require('../config');
const User = require('../models/User');
const { resolveOrgPrincipal } = require('./orgPrincipalService');
const { loadPolicySpecs } = require('./retentionService');

function positiveEnv(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecent(value, staleMinutes) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  const future = Date.now()
    + positiveEnv('CGNAT_ATTRIBUTION_MAX_CLOCK_SKEW_SECONDS', 300, 3600) * 1000;
  return Number.isFinite(timestamp) && timestamp <= future
    && timestamp >= Date.now() - staleMinutes * 60000;
}

function sourceStatus(configured, receiving) {
  if (receiving) return 'receiving';
  return configured ? 'waiting_for_traffic' : 'not_configured';
}

async function tokenState(organizationId, includeCgnat) {
  return db.withPrimaryContext(async () => {
    const [[control = {}]] = await db.query(
      `SELECT EXISTS(SELECT 1 FROM organization_database_configs
         WHERE organization_id = ? AND isolation_mode = 'isolated') AS isolated,
        (SELECT last_run_at FROM scheduled_tasks WHERE task_name = 'purge_radius_accounting'
          AND organization_id IS NULL LIMIT 1) AS retention_last_run_at,
        (SELECT last_status FROM scheduled_tasks WHERE task_name = 'purge_radius_accounting'
          AND organization_id IS NULL LIMIT 1) AS retention_last_status`,
      [organizationId],
    );
    const [tokens] = await db.query(
      `SELECT token.id, token.user_id, JSON_UNQUOTE(JSON_EXTRACT(token.scopes, '$[0]')) AS exact_scope
       FROM api_tokens token JOIN users actor ON actor.id = token.user_id
        AND actor.status = 'active' AND actor.deleted_at IS NULL
       WHERE token.organization_id = ? AND token.deleted_at IS NULL
        AND token.revoked_at IS NULL AND (token.expires_at IS NULL OR token.expires_at > NOW())
        AND JSON_LENGTH(token.scopes) = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(token.scopes, '$[0]')) IN
          ('connection_logs:ingest','cgnat_attribution:ingest')`, [organizationId],
    );
    let sessionTokens = 0; let cgnatTokens = 0; const cgnatTokenIds = [];
    for (const token of tokens) {
      if (!await resolveOrgPrincipal({ id: token.user_id }, organizationId, { allowOperator: false })) continue;
      const permissions = await User.getPermissions(token.user_id, organizationId);
      if (token.exact_scope === 'connection_logs:ingest' && permissions.includes('connection_logs.ingest')) sessionTokens += 1;
      if (includeCgnat && token.exact_scope === 'cgnat_attribution:ingest'
          && permissions.includes('cgnat_attribution.ingest')) {
        cgnatTokens += 1;
        cgnatTokenIds.push(Number(token.id));
      }
    }
    return { ...control, session_tokens: sessionTokens, cgnat_tokens: cgnatTokens,
      cgnat_token_ids: cgnatTokenIds };
  });
}

async function getReadiness(organizationId, { includeCgnat = true } = {}) {
  const sessionStale = positiveEnv('CONNECTION_LOGGER_STALE_MINUTES', 15, 1440);
  const cgnatStale = positiveEnv('CGNAT_ATTRIBUTION_STALE_MINUTES', 15, 1440);
  const stalePortHours = positiveEnv('CGNAT_ATTRIBUTION_OPEN_BINDING_STALE_HOURS', 24, 8760);
  const staleBlockDays = positiveEnv('CGNAT_ATTRIBUTION_OPEN_PORT_BLOCK_STALE_DAYS', 31, 3650);
  const control = await tokenState(organizationId, includeCgnat);
  const isolated = Boolean(control.isolated);
  const policies = loadPolicySpecs();

  const baseQueries = await Promise.all([
    db.query(`SELECT COUNT(*) AS total, SUM(source_nas.maintenance_mode = 1) AS maintenance,
      SUM(
        EXISTS (SELECT 1 FROM connection_logs current_session
          WHERE current_session.organization_id = source_nas.organization_id
            AND current_session.nas_id = source_nas.id
            AND current_session.client_id IS NOT NULL AND current_session.client_id <> 0
            AND current_session.contract_id IS NOT NULL AND current_session.contract_id <> 0
            AND current_session.session_instance_id IS NOT NULL
            AND current_session.attribution_evidence_complete = 1
            AND COALESCE(current_session.last_accounting_at, current_session.event_at)
              >= DATE_SUB(NOW(), INTERVAL ${sessionStale} MINUTE)
            AND COALESCE(current_session.last_accounting_received_at,
              current_session.last_accounting_at, current_session.event_at)
              >= DATE_SUB(NOW(), INTERVAL ${sessionStale} MINUTE))
        OR EXISTS (SELECT 1 FROM radius_accounting_events current_evidence
          JOIN connection_logs evidence_session
            ON evidence_session.id = current_evidence.connection_log_id
           AND evidence_session.organization_id = current_evidence.organization_id
           AND evidence_session.client_id IS NOT NULL AND evidence_session.client_id <> 0
           AND evidence_session.contract_id IS NOT NULL AND evidence_session.contract_id <> 0
           AND evidence_session.session_instance_id IS NOT NULL
           AND evidence_session.attribution_evidence_complete = 1
          WHERE current_evidence.organization_id = source_nas.organization_id
            AND current_evidence.nas_id = source_nas.id
            AND current_evidence.event_at >= DATE_SUB(NOW(), INTERVAL ${sessionStale} MINUTE)
            AND current_evidence.observed_at >= DATE_SUB(NOW(), INTERVAL ${sessionStale} MINUTE))
      ) AS evidence_covered_sources
      FROM nas source_nas
      WHERE source_nas.organization_id = ? AND source_nas.status = 'active'
        AND source_nas.deleted_at IS NULL`, [organizationId]),
    db.query(`SELECT COUNT(*) AS total FROM contracts WHERE organization_id = ?
      AND status = 'active' AND deleted_at IS NULL`, [organizationId]),
    db.query(`SELECT MAX(evidence.observed_at) AS last_received_at,
      MAX(evidence.event_at) AS latest_event_at,
      SUM(evidence.observed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS events_24h,
      COUNT(DISTINCT CASE WHEN evidence.observed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        THEN evidence.nas_id END) AS evidence_sources_24h
      FROM radius_accounting_events evidence
      JOIN connection_logs evidence_session
        ON evidence_session.id = evidence.connection_log_id
       AND evidence_session.organization_id = evidence.organization_id
       AND evidence_session.client_id IS NOT NULL AND evidence_session.client_id <> 0
       AND evidence_session.contract_id IS NOT NULL AND evidence_session.contract_id <> 0
       AND evidence_session.session_instance_id IS NOT NULL
       AND evidence_session.attribution_evidence_complete = 1
      JOIN nas source_nas ON source_nas.id = evidence.nas_id
       AND source_nas.organization_id = evidence.organization_id
       AND source_nas.status = 'active' AND source_nas.deleted_at IS NULL
      WHERE evidence.organization_id = ?`, [organizationId]),
    db.query(`SELECT COUNT(*) AS active_sessions,
      SUM(client_id IS NOT NULL AND client_id <> 0
        AND contract_id IS NOT NULL AND contract_id <> 0
        AND session_instance_id IS NOT NULL
        AND attribution_evidence_complete = 1) AS attributable_active_sessions,
      MAX(last_accounting_received_at) AS last_received_at,
      MAX(last_accounting_at) AS last_projection_at,
      COUNT(DISTINCT CASE WHEN last_accounting_received_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        THEN nas_id END) AS covered_sources_24h,
      SUM(client_id IS NOT NULL AND client_id <> 0
        AND contract_id IS NOT NULL AND contract_id <> 0
        AND session_instance_id IS NOT NULL
        AND attribution_evidence_complete = 1 AND EXISTS (
        SELECT 1 FROM radius_accounting_events evidence
         WHERE evidence.organization_id = connection_logs.organization_id
           AND evidence.session_instance_id = connection_logs.session_instance_id
           AND evidence.framed_ip = COALESCE(connection_logs.framed_ip, connection_logs.ip_address)
           AND evidence.event_at <= connection_logs.last_accounting_at
           AND evidence.observed_at <= connection_logs.last_accounting_received_at
      )) AS evidence_anchored_active_sessions
      FROM connection_logs WHERE organization_id = ? AND event_type IN ('start','interim-update')
       AND last_accounting_received_at >= DATE_SUB(NOW(), INTERVAL ${positiveEnv('RADIUS_SESSION_LIVENESS_MINUTES', 60, 1440)} MINUTE)`, [organizationId]),
    db.query(`SELECT COUNT(*) AS total FROM connection_logs cl WHERE cl.organization_id IS NULL
      AND EXISTS (SELECT 1 FROM nas WHERE nas.id = cl.nas_id AND nas.organization_id = ?)`, [organizationId]),
    db.query(`SELECT SUM(partition_name <> 'p_future') AS radius_partitions,
      EXISTS(SELECT 1 FROM information_schema.EVENTS WHERE event_schema = DATABASE()
       AND event_name = 'evt_subscriber_logging_partition_maintenance' AND status = 'ENABLED') AS partition_event_enabled,
      @@event_scheduler AS event_scheduler_status FROM information_schema.PARTITIONS
      WHERE table_schema = DATABASE() AND table_name = 'radius_accounting_events'`),
  ]);

  let exporter = {}; let event = {}; let binding = {}; let holds = {};
  if (includeCgnat) {
    const cgnatResults = await Promise.all([
      db.query(`SELECT COUNT(CASE WHEN config.is_required = 1 THEN 1 END) AS expected_exporters,
        COUNT(DISTINCT CASE WHEN config.is_required = 1 THEN config.nat_pool_record_id END) AS expected_pools,
        SUM(config.enabled = 1 AND config.is_required = 1) AS enabled_exporters,
        SUM(config.enabled = 1 AND config.is_required = 1
          AND config.purpose_reference IS NOT NULL AND TRIM(config.purpose_reference) <> ''
          AND config.collection_approved_at IS NOT NULL
          AND config.authoritative_baseline_confirmed = 1
          AND config.baseline_confirmed_at IS NOT NULL
          AND config.baseline_reference IS NOT NULL AND TRIM(config.baseline_reference) <> ''
          AND config.tuple_exclusivity_confirmed = 1
          AND pool.status = 'active' AND pool.deleted_at IS NULL
          AND pool.external_ip_start = config.public_ipv4_start
          AND pool.external_ip_end = config.public_ipv4_end) AS approved_exporters,
        SUM(config.enabled = 1 AND config.is_required = 1
          AND config.last_binding_received_at >= DATE_SUB(NOW(), INTERVAL ${cgnatStale} MINUTE)) AS receiving_exporters,
        SUM(config.enabled = 1 AND config.is_required = 1
          AND config.purpose_reference IS NOT NULL AND TRIM(config.purpose_reference) <> ''
          AND config.collection_approved_at IS NOT NULL AND config.tuple_exclusivity_confirmed = 1
          AND config.authoritative_baseline_confirmed = 1
          AND config.baseline_confirmed_at IS NOT NULL
          AND config.baseline_reference IS NOT NULL AND TRIM(config.baseline_reference) <> ''
          AND config.last_binding_received_at >= DATE_SUB(NOW(), INTERVAL ${cgnatStale} MINUTE)
          AND config.coverage_horizon_at >= DATE_SUB(NOW(), INTERVAL ${cgnatStale} MINUTE)
          AND config.sequence_gap_events = 0 AND config.sequence_missing_records = 0
          AND config.out_of_order_events = 0 AND config.reported_lost_records = 0
          AND config.incomplete_metadata_events = 0 AND pool.status = 'active'
          AND pool.deleted_at IS NULL AND pool.external_ip_start = config.public_ipv4_start
          AND pool.external_ip_end = config.public_ipv4_end) AS complete_exporters,
        MAX(config.last_binding_received_at) AS last_received_at,
        MAX(config.last_device_recorded_at) AS last_device_recorded_at,
        MAX(config.last_corrected_device_at) AS last_corrected_device_at,
        MAX(config.coverage_horizon_at) AS coverage_horizon_at,
        SUM(config.sequence_gap_events + config.sequence_missing_records
          + config.out_of_order_events) AS sequence_faults,
        SUM(config.reported_lost_records) AS reported_lost_records
       FROM cgnat_exporter_configs config LEFT JOIN nat_pools pool
        ON pool.id = config.nat_pool_record_id AND pool.organization_id = config.organization_id
       WHERE config.organization_id = ?`, [organizationId]),
      db.query(`SELECT COUNT(*) AS events_24h,
        SUM(clock_offset_ms IS NULL OR clock_uncertainty_ms IS NULL
          OR records_lost_before IS NULL) AS incomplete_metadata_24h,
        SUM(sequence_status IN ('gap','out_of_order')) AS sequence_gap_events_24h,
        SUM(COALESCE(records_lost_before,0)) AS reported_lost_records_24h,
        MAX(ABS(clock_offset_ms)) AS max_clock_offset_ms
       FROM cgnat_binding_events WHERE organization_id = ?
        AND received_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`, [organizationId]),
      db.query(`SELECT SUM(released_at IS NULL) AS open_bindings,
        SUM(released_at IS NULL AND binding_type = 'single_port'
          AND allocation_received_at < DATE_SUB(NOW(), INTERVAL ${stalePortHours} HOUR)) AS stale_ports,
        SUM(released_at IS NULL AND binding_type = 'port_block'
          AND allocation_received_at < DATE_SUB(NOW(), INTERVAL ${staleBlockDays} DAY)) AS stale_blocks,
        SUM(allocation_received_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS bindings_24h,
        SUM(allocation_received_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND metadata_complete = 0) AS incomplete_bindings_24h
       FROM cgnat_attribution_bindings WHERE organization_id = ?`, [organizationId]),
      db.query(`SELECT COUNT(*) AS active_holds FROM ip_attribution_case_evidence
       WHERE organization_id = ? AND hold_released_at IS NULL`, [organizationId]),
      db.query(`SELECT id, collector_api_token_id FROM cgnat_exporter_configs
        WHERE organization_id = ? AND is_required = 1`, [organizationId]),
      db.query(`SELECT COUNT(*) AS overlapping_pairs
        FROM cgnat_exporter_configs left_config
        JOIN cgnat_exporter_configs right_config
          ON right_config.organization_id = left_config.organization_id
         AND right_config.id > left_config.id
         AND right_config.enabled = 1 AND right_config.is_required = 1
         AND INET_ATON(right_config.public_ipv4_start) <= INET_ATON(left_config.public_ipv4_end)
         AND INET_ATON(right_config.public_ipv4_end) >= INET_ATON(left_config.public_ipv4_start)
       WHERE left_config.organization_id = ?
         AND left_config.enabled = 1 AND left_config.is_required = 1`, [organizationId]),
      db.query(`SELECT COUNT(*) AS active_cgnat_pools FROM nat_pools
        WHERE organization_id = ? AND nat_type IN ('cgnat','pat')
          AND status = 'active' AND deleted_at IS NULL`, [organizationId]),
    ]);
    exporter = cgnatResults[0][0]?.[0] || {};
    event = cgnatResults[1][0]?.[0] || {};
    binding = cgnatResults[2][0]?.[0] || {};
    holds = cgnatResults[3][0]?.[0] || {};
    exporter.required_token_rows = cgnatResults[4][0] || [];
    exporter.overlapping_pairs = Number(cgnatResults[5][0]?.[0]?.overlapping_pairs || 0);
    exporter.active_cgnat_pools = Number(cgnatResults[6][0]?.[0]?.active_cgnat_pools || 0);
  }

  const [nasResult, contractResult, sessionResult, projectionResult, legacyResult, partitionResult] = baseQueries;
  const nasRow = nasResult[0]?.[0] || {};
  const contractRow = contractResult[0]?.[0] || {};
  const sessionRow = sessionResult[0]?.[0] || {};
  const projectionRow = projectionResult[0]?.[0] || {};
  const legacyRow = legacyResult[0]?.[0] || {};
  const partitionRow = partitionResult[0]?.[0] || {};
  const activeNas = Number(nasRow.total || 0);
  const activeContracts = Number(contractRow.total || 0);
  const lastSession = projectionRow.last_received_at || sessionRow.last_received_at;
  const sessionConfigured = Boolean(lastSession || control.session_tokens
    || (!isolated && (config.radiusServer?.enabled || process.env.RADIUS_ACCOUNTING_SECRET)));
  const sessionReceiving = isRecent(lastSession, sessionStale);
  const latestSessionTimeline = projectionRow.last_projection_at || sessionRow.latest_event_at;
  const sessionTimelineCurrent = isRecent(latestSessionTimeline, sessionStale);
  const activeSessions = Number(projectionRow.active_sessions || 0);
  const attributableActiveSessions = Number(projectionRow.attributable_active_sessions || 0);
  const anchoredActiveSessions = Number(projectionRow.evidence_anchored_active_sessions || 0);
  const coveredSessionSources = Number(nasRow.evidence_covered_sources || 0);
  // Without a separate opt-out inventory, every active NAS is expected. This
  // is intentionally conservative: a silent or dummy active source cannot make
  // direct-public attribution appear fleet-complete.
  const sourceCoverageComplete = activeNas > 0 && coveredSessionSources === activeNas;
  const lifecycleReceiving = (activeSessions > 0
    ? attributableActiveSessions === activeSessions
      && anchoredActiveSessions === attributableActiveSessions
    : Number(sessionRow.events_24h || 0) > 0) && sourceCoverageComplete;
  const sessionReady = activeNas > 0 && activeContracts > 0 && sessionConfigured
    && sessionReceiving && sessionTimelineCurrent && lifecycleReceiving;

  const expected = Number(exporter.expected_exporters || 0);
  const activeCgnatPools = Number(exporter.active_cgnat_pools || 0);
  const receiving = Number(exporter.receiving_exporters || 0);
  const validTokenIds = new Set(control.cgnat_token_ids || []);
  const invalidBoundTokens = (exporter.required_token_rows || [])
    .filter(row => !validTokenIds.has(Number(row.collector_api_token_id))).length;
  const complete = Math.max(0, Number(exporter.complete_exporters || 0) - invalidBoundTokens);
  const enabledExporters = Number(exporter.enabled_exporters || 0);
  const approvedExporters = Number(exporter.approved_exporters || 0);
  const staleOpen = Number(binding.stale_ports || 0) + Number(binding.stale_blocks || 0);
  const cgnatApplicable = includeCgnat && (activeCgnatPools > 0
    || expected > 0 || Number(control.cgnat_tokens || 0) > 0);
  const cgnatConfigured = cgnatApplicable && expected > 0 && Number(control.cgnat_tokens || 0) > 0;
  const cgnatStructureComplete = cgnatConfigured && enabledExporters === expected
    && approvedExporters === expected && invalidBoundTokens === 0
    && Number(exporter.expected_pools || 0) === activeCgnatPools
    && Number(exporter.overlapping_pairs || 0) === 0;
  const cgnatReady = cgnatStructureComplete && receiving === expected && complete === expected
    && staleOpen === 0 && Number(exporter.overlapping_pairs || 0) === 0;
  const ready = sessionReady && (!cgnatApplicable || cgnatReady);
  const status = activeNas === 0 || activeContracts === 0 ? 'not_applicable'
    : !sessionConfigured ? 'not_configured'
      : !sessionReceiving ? 'waiting_for_traffic'
        : !sessionTimelineCurrent || !lifecycleReceiving ? 'partial'
          : cgnatApplicable && !cgnatReady ? 'partial' : 'ready';

  const sessionTables = ['connection_logs', 'radius_accounting_events', 'radius_accounting_usage_daily'];
  const sessionPolicies = Object.fromEntries(sessionTables.map(table => [table, policies[table]]));
  return {
    ready, status, checked_at: new Date().toISOString(),
    database_scope: isolated ? 'isolated' : 'shared',
    active_nas: activeNas, maintenance_nas: Number(nasRow.maintenance || 0),
    active_contracts: activeContracts,
    unattributed_legacy_sessions: Number(legacyRow.total || 0),
    session_logger: {
      configured: sessionConfigured,
      status: !sessionConfigured ? 'not_configured' : !sessionReceiving
        ? 'waiting_for_traffic'
        : !sessionTimelineCurrent || !lifecycleReceiving ? 'incomplete' : 'receiving',
      ready: sessionReady,
      receiving: sessionReceiving,
      healthy: sessionReceiving && sessionTimelineCurrent && lifecycleReceiving,
      last_received_at: isoOrNull(lastSession), last_event_at: isoOrNull(sessionRow.latest_event_at),
      lifecycle_evidence_24h: Number(sessionRow.events_24h || 0),
      active_sessions: activeSessions,
      attributable_active_sessions: attributableActiveSessions,
      evidence_anchored_active_sessions: anchoredActiveSessions,
      covered_sources: coveredSessionSources, total_sources: activeNas,
      source_coverage_complete: sourceCoverageComplete,
      direct_public_attribution_ready: sessionReady,
      last_projection_at: isoOrNull(projectionRow.last_projection_at),
      timeline_current: sessionTimelineCurrent,
    },
    cgnat_attribution: includeCgnat ? {
      ready: cgnatReady, configured: cgnatConfigured,
      status: !cgnatApplicable ? 'not_configured'
        : !cgnatStructureComplete ? 'configuration_incomplete'
          : receiving !== expected ? 'waiting_for_traffic'
            : complete !== expected || staleOpen > 0 ? 'incomplete' : 'receiving',
      collector_tokens: Number(control.cgnat_tokens || 0),
      expected_exporters: expected, expected_pools: Number(exporter.expected_pools || 0),
      active_cgnat_pools: activeCgnatPools,
      enabled_exporters: enabledExporters, approved_exporters: approvedExporters,
      receiving_exporters: receiving, complete_exporters: complete,
      invalid_bound_exporter_tokens: invalidBoundTokens,
      overlapping_required_pool_pairs: Number(exporter.overlapping_pairs || 0),
      coverage_status: !cgnatApplicable ? 'not_configured'
        : complete === expected && expected > 0 ? 'complete' : 'incomplete',
      last_received_at: isoOrNull(exporter.last_received_at),
      last_device_recorded_at: isoOrNull(exporter.last_device_recorded_at),
      last_corrected_device_at: isoOrNull(exporter.last_corrected_device_at),
      coverage_horizon_at: isoOrNull(exporter.coverage_horizon_at),
      bindings_24h: Number(binding.bindings_24h || 0), events_24h: Number(event.events_24h || 0),
      open_bindings: Number(binding.open_bindings || 0), stale_open_bindings: staleOpen,
      incomplete_metadata_24h: Number(event.incomplete_metadata_24h || 0),
      sequence_gap_events_24h: Number(event.sequence_gap_events_24h || 0),
      reported_lost_records_24h: Number(event.reported_lost_records_24h || 0),
      clock_status: Number(event.incomplete_metadata_24h || 0) > 0 ? 'incomplete'
        : Number(event.events_24h || 0) > 0 ? 'reported' : 'unknown',
      max_clock_offset_ms: event.max_clock_offset_ms === null
        || event.max_clock_offset_ms === undefined ? null : Number(event.max_clock_offset_ms),
      loss_status: Number(exporter.sequence_faults || 0) + Number(exporter.reported_lost_records || 0) > 0
        ? 'unresolved' : 'clear',
      active_case_holds: Number(holds.active_holds || 0),
      supported_nat_mode: 'endpoint_independent_tcp_udp_public_tuple',
    } : { authorized: false, status: 'not_authorized' },
    retention: {
      session_months: Object.values(sessionPolicies).every(policy => policy?.unit === 'MONTH')
        ? Math.min(...Object.values(sessionPolicies).map(policy => policy.value)) : null,
      ...(includeCgnat ? { cgnat_months: policies.cgnat_attribution_bindings?.unit === 'MONTH'
        ? policies.cgnat_attribution_bindings.value : null } : {}),
      effective_policies: { ...sessionPolicies, ...(includeCgnat ? {
        cgnat_binding_events: policies.cgnat_binding_events,
        cgnat_attribution_bindings: policies.cgnat_attribution_bindings,
      } : {}) },
      last_run_at: isoOrNull(control.retention_last_run_at), last_status: control.retention_last_status || null,
      partition_event_enabled: Boolean(partitionRow.partition_event_enabled)
        && String(partitionRow.event_scheduler_status).toUpperCase() === 'ON',
      event_scheduler_status: partitionRow.event_scheduler_status || null,
      radius_partitions: Number(partitionRow.radius_partitions || 0),
    },
    caveats: [
      'Operational readiness is not a legal-compliance certification or proof of a human action.',
      'IP attribution stores no destination address, URL, content, packet payload, or browsing history.',
      'CGNAT v1 supports TCP/UDP endpoint-independent public tuples only; destination-dependent NAT is unsupported.',
      'CGNAT v1 has no standalone heartbeat: a quiet exporter or long-lived port block is unavailable after the last certain allocate/release evidence horizon.',
      ...(staleOpen ? ['Stale open CGNAT allocations require reconciliation and are never purged automatically.'] : []),
    ],
  };
}

module.exports = { getReadiness, isRecent, positiveEnv, sourceStatus };
