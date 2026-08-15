'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));
jest.mock('../src/config', () => ({
  radiusSessionLivenessMinutes: 60,
  radiusServer: { enabled: false },
}));
jest.mock('../src/models/User', () => ({ getPermissions: jest.fn() }));
jest.mock('../src/services/orgPrincipalService', () => ({ resolveOrgPrincipal: jest.fn() }));
jest.mock('../src/services/retentionService', () => ({
  loadPolicySpecs: jest.fn(() => ({
    connection_logs: { value: 24, unit: 'MONTH' },
    radius_accounting_events: { value: 24, unit: 'MONTH' },
    radius_accounting_usage_daily: { value: 24, unit: 'MONTH' },
    cgnat_binding_events: { value: 24, unit: 'MONTH' },
    cgnat_attribution_bindings: { value: 24, unit: 'MONTH' },
  })),
}));

const db = require('../src/config/database');
const User = require('../src/models/User');
const { resolveOrgPrincipal } = require('../src/services/orgPrincipalService');
const { getReadiness } = require('../src/services/connectionLoggingReadinessService');

const NOW = new Date('2026-08-15T12:00:00.000Z');
const RECENT = new Date('2026-08-15T11:58:00.000Z');

function readinessDatabase(overrides = {}) {
  const state = {
    control: {
      isolated: 0,
      retention_last_run_at: RECENT,
      retention_last_status: 'success',
    },
    tokens: [
      { id: 90, user_id: 50, exact_scope: 'connection_logs:ingest' },
      { id: 99, user_id: 50, exact_scope: 'cgnat_attribution:ingest' },
    ],
    nas: { total: 1, maintenance: 0, evidence_covered_sources: 1 },
    contracts: { total: 1 },
    radiusEvents: {
      last_received_at: RECENT,
      latest_event_at: RECENT,
      events_24h: 1,
      evidence_sources_24h: 1,
    },
    projection: {
      active_sessions: 0,
      last_received_at: null,
      last_projection_at: null,
      covered_sources_24h: 0,
      evidence_anchored_active_sessions: 0,
    },
    legacy: { total: 0 },
    partitions: { radius_partitions: 3, partition_event_enabled: 1, event_scheduler_status: 'ON' },
    exporter: {
      expected_exporters: 1,
      expected_pools: 1,
      enabled_exporters: 1,
      approved_exporters: 1,
      receiving_exporters: 1,
      complete_exporters: 1,
      last_received_at: RECENT,
      last_device_recorded_at: RECENT,
      last_corrected_device_at: RECENT,
      coverage_horizon_at: RECENT,
      sequence_faults: 0,
      reported_lost_records: 0,
    },
    events: {
      events_24h: 1,
      incomplete_metadata_24h: 0,
      sequence_gap_events_24h: 0,
      reported_lost_records_24h: 0,
      max_clock_offset_ms: 0,
    },
    bindings: {
      open_bindings: 0,
      stale_ports: 0,
      stale_blocks: 0,
      bindings_24h: 1,
      incomplete_bindings_24h: 0,
    },
    holds: { active_holds: 0 },
    requiredTokens: [{ id: 7, collector_api_token_id: 99 }],
    overlap: { overlapping_pairs: 0 },
    activePools: { active_cgnat_pools: 1 },
    ...overrides,
  };

  db.query.mockImplementation(async (sql) => {
    if (/FROM organization_database_configs/.test(sql)) return [[state.control]];
    if (/FROM api_tokens token/.test(sql)) return [state.tokens];
    if (/FROM nas(?: source_nas)?[\s\S]*WHERE (?:source_nas\.)?organization_id/.test(sql)) return [[state.nas]];
    if (/FROM contracts WHERE organization_id/.test(sql)) return [[state.contracts]];
    if (/FROM radius_accounting_events(?: evidence)?[\s\S]*WHERE (?:evidence\.)?organization_id/.test(sql)) {
      return [[state.radiusEvents]];
    }
    if (/FROM connection_logs WHERE organization_id/.test(sql)) return [[state.projection]];
    if (/FROM connection_logs cl WHERE cl\.organization_id IS NULL/.test(sql)) {
      return [[state.legacy]];
    }
    if (/FROM information_schema\.PARTITIONS/.test(sql)) return [[state.partitions]];
    if (/COUNT\(CASE WHEN config\.is_required/.test(sql)) return [[state.exporter]];
    if (/FROM cgnat_binding_events WHERE organization_id/.test(sql)) return [[state.events]];
    if (/FROM cgnat_attribution_bindings WHERE organization_id/.test(sql)) {
      return [[state.bindings]];
    }
    if (/FROM ip_attribution_case_evidence/.test(sql)) return [[state.holds]];
    if (/SELECT id, collector_api_token_id FROM cgnat_exporter_configs/.test(sql)) {
      return [state.requiredTokens];
    }
    if (/COUNT\(\*\) AS overlapping_pairs/.test(sql)) return [[state.overlap]];
    if (/COUNT\(\*\) AS active_cgnat_pools/.test(sql)) return [[state.activePools]];
    throw new Error(`Unexpected readiness SQL: ${sql}`);
  });
  return state;
}

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  db.withPrimaryContext.mockImplementation(callback => callback());
  resolveOrgPrincipal.mockResolvedValue({ id: 50 });
  User.getPermissions.mockResolvedValue([
    'connection_logs.ingest', 'cgnat_attribution.ingest',
  ]);
});

describe('privacy-minimal attribution readiness', () => {
  test('treats a quiet tenant with recent lifecycle evidence and zero active sessions consistently', async () => {
    readinessDatabase();

    const result = await getReadiness(10, { includeCgnat: false });

    expect(result).toMatchObject({
      ready: true,
      status: 'ready',
      session_logger: {
        status: 'receiving',
        active_sessions: 0,
        evidence_anchored_active_sessions: 0,
        direct_public_attribution_ready: true,
      },
      cgnat_attribution: { authorized: false, status: 'not_authorized' },
    });
    expect(db.query.mock.calls.some(([sql]) => /cgnat_exporter_configs/.test(sql))).toBe(false);
  });

  test('reports a fully approved, baselined, exact-token exporter as ready', async () => {
    readinessDatabase();

    const result = await getReadiness(10, { includeCgnat: true });

    expect(result).toMatchObject({
      ready: true,
      status: 'ready',
      cgnat_attribution: {
        ready: true,
        configured: true,
        status: 'receiving',
        collector_tokens: 1,
        expected_exporters: 1,
        enabled_exporters: 1,
        approved_exporters: 1,
        receiving_exporters: 1,
        complete_exporters: 1,
        invalid_bound_exporter_tokens: 0,
        coverage_status: 'complete',
        loss_status: 'clear',
      },
    });
  });

  test('calls a disabled required exporter configuration incomplete, not waiting for traffic', async () => {
    readinessDatabase({
      exporter: {
        expected_exporters: 1,
        expected_pools: 1,
        enabled_exporters: 0,
        approved_exporters: 0,
        receiving_exporters: 0,
        complete_exporters: 0,
        last_received_at: null,
        last_device_recorded_at: null,
        last_corrected_device_at: null,
        coverage_horizon_at: null,
        sequence_faults: 0,
        reported_lost_records: 0,
      },
    });

    const result = await getReadiness(10, { includeCgnat: true });

    expect(result.ready).toBe(false);
    expect(result.status).toBe('partial');
    expect(result.cgnat_attribution).toMatchObject({
      ready: false,
      configured: true,
      status: 'configuration_incomplete',
      expected_exporters: 1,
      enabled_exporters: 0,
    });
  });

  test('fails readiness when a required exporter is bound to a different token', async () => {
    readinessDatabase({
      requiredTokens: [{ id: 7, collector_api_token_id: 100 }],
    });

    const result = await getReadiness(10, { includeCgnat: true });

    expect(result.ready).toBe(false);
    expect(result.cgnat_attribution).toMatchObject({
      status: 'configuration_incomplete',
      invalid_bound_exporter_tokens: 1,
      complete_exporters: 0,
      coverage_status: 'incomplete',
    });
  });

  test('keeps loss faults and stale open mappings fail-closed', async () => {
    readinessDatabase({
      exporter: {
        expected_exporters: 1,
        expected_pools: 1,
        enabled_exporters: 1,
        approved_exporters: 1,
        receiving_exporters: 1,
        complete_exporters: 0,
        last_received_at: RECENT,
        last_device_recorded_at: RECENT,
        last_corrected_device_at: RECENT,
        coverage_horizon_at: RECENT,
        sequence_faults: 1,
        reported_lost_records: 2,
      },
      bindings: {
        open_bindings: 3,
        stale_ports: 1,
        stale_blocks: 1,
        bindings_24h: 1,
        incomplete_bindings_24h: 0,
      },
    });

    const result = await getReadiness(10, { includeCgnat: true });

    expect(result.cgnat_attribution).toMatchObject({
      ready: false,
      status: 'incomplete',
      stale_open_bindings: 2,
      complete_exporters: 0,
      loss_status: 'unresolved',
    });
    expect(result.caveats).toEqual(expect.arrayContaining([
      expect.stringMatching(/Stale open CGNAT allocations/),
    ]));
  });

  test('treats overlapping required pool coverage as configuration incomplete', async () => {
    readinessDatabase({ overlap: { overlapping_pairs: 1 } });

    const result = await getReadiness(10, { includeCgnat: true });

    expect(result.cgnat_attribution).toMatchObject({
      ready: false,
      status: 'configuration_incomplete',
      overlapping_required_pool_pairs: 1,
    });
  });

  test('does not let one current NAS mask a stale backlog-only NAS', async () => {
    readinessDatabase({
      nas: { total: 2, maintenance: 0, evidence_covered_sources: 1 },
      radiusEvents: {
        last_received_at: RECENT, latest_event_at: RECENT,
        events_24h: 2, evidence_sources_24h: 2,
      },
    });

    const result = await getReadiness(37, { includeCgnat: true });

    expect(result.session_logger).toMatchObject({
      total_sources: 2, covered_sources: 1,
      source_coverage_complete: false,
      direct_public_attribution_ready: false,
    });
    expect(result.ready).toBe(false);
  });

  test('requires both safe timeline and exporter horizon freshness', async () => {
    readinessDatabase({
      radiusEvents: {
        last_received_at: RECENT, latest_event_at: '2026-07-01T00:00:00.000Z',
        events_24h: 1, evidence_sources_24h: 1,
      },
      nas: { total: 1, maintenance: 0, evidence_covered_sources: 0 },
    });

    const result = await getReadiness(37, { includeCgnat: true });
    expect(result.session_logger).toMatchObject({
      receiving: true, timeline_current: false, ready: false,
    });
    const exporterSql = db.query.mock.calls.find(([sql]) => (
      /COUNT\(CASE WHEN config\.is_required/.test(sql)
    ))[0];
    expect(exporterSql).toMatch(/coverage_horizon_at >= DATE_SUB\(NOW\(\), INTERVAL 15 MINUTE\)/);
  });

  test('anchors NAS event time and later local receipt in their own time domains', async () => {
    readinessDatabase();

    await getReadiness(37, { includeCgnat: false });

    const projectionSql = db.query.mock.calls.find(([sql]) => (
      /evidence_anchored_active_sessions/.test(sql)
    ))[0];
    expect(projectionSql).toContain('evidence.event_at <= connection_logs.last_accounting_at');
    expect(projectionSql).toContain(
      'evidence.observed_at <= connection_logs.last_accounting_received_at',
    );
    expect(projectionSql).not.toContain(
      'evidence.observed_at <= connection_logs.last_accounting_at',
    );
  });

  test('passes the tenant predicate to every tenant-owned readiness query', async () => {
    readinessDatabase();

    await getReadiness(37, { includeCgnat: true });

    const tenantTables = [
      'organization_database_configs', 'api_tokens token', 'FROM nas', 'FROM contracts',
      'radius_accounting_events evidence', 'connection_logs WHERE',
      'connection_logs cl WHERE', 'cgnat_exporter_configs config LEFT',
      'cgnat_binding_events WHERE', 'cgnat_attribution_bindings WHERE',
      'ip_attribution_case_evidence', 'SELECT id, collector_api_token_id',
      'cgnat_exporter_configs left_config',
      'active_cgnat_pools FROM nat_pools',
    ];
    for (const marker of tenantTables) {
      const call = db.query.mock.calls.find(([sql]) => sql.includes(marker));
      expect(call).toBeDefined();
      expect(call[1]).toContain(37);
    }
    expect(resolveOrgPrincipal).toHaveBeenCalledWith(
      { id: 50 }, 37, { allowOperator: false },
    );
    expect(User.getPermissions).toHaveBeenCalledWith(50, 37);
  });
});
