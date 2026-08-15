'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));
jest.mock('../src/models/User', () => ({ getPermissions: jest.fn() }));
jest.mock('../src/services/orgPrincipalService', () => ({
  resolveOrgPrincipal: jest.fn().mockResolvedValue({ id: 50 }),
}));

const db = require('../src/config/database');
const {
  ingestBatch,
  lookupAttribution,
  normalizeBinding,
  sequenceState,
} = require('../src/services/cgnatAttributionService');
const { governmentRequestRowHash } = require('../src/utils/govDataRequestIntegrity');

const ORGANIZATION_ID = 10;
const SESSION_INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const UTC_EVENT = '2026-08-01T00:10:00.000Z';

function isoAdd(iso, milliseconds) {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}

function binding(overrides = {}) {
  return {
    event_type: 'allocate',
    binding_key: 'binding-1',
    binding_type: 'single_port',
    private_ipv4: '10.0.0.10',
    private_port_start: 5000,
    private_port_end: 5000,
    public_ipv4: '8.8.8.8',
    public_port_start: 45000,
    public_port_end: 45000,
    protocol: 'tcp',
    allocated_at: UTC_EVENT,
    released_at: null,
    session_instance_id: SESSION_INSTANCE_ID,
    exporter_id: 'edge-1',
    exporter_ip: null,
    exporter_boot_id: 'boot-a',
    nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1',
    nat_realm: 'internet',
    event_id: 'event-1',
    sequence_number: 0,
    device_recorded_at: UTC_EVENT,
    clock_offset_ms: 0,
    clock_uncertainty_ms: 0,
    records_lost_before: 0,
    ...overrides,
  };
}

function exporter(overrides = {}) {
  return {
    id: 7,
    organization_id: ORGANIZATION_ID,
    collector_api_token_id: 99,
    exporter_id: 'edge-1',
    exporter_nas_id: null,
    exporter_ip: null,
    nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1',
    nat_realm: 'internet',
    public_ipv4_start: '8.8.8.1',
    public_ipv4_end: '8.8.8.254',
    enabled: 1,
    is_required: 1,
    purpose_reference: 'approved purpose',
    collection_approved_at: '2026-07-31T00:00:00.000Z',
    authoritative_baseline_confirmed: 1,
    baseline_reference: 'empty epoch 1',
    baseline_confirmed_at: '2026-07-31T00:00:00.000Z',
    last_exporter_boot_id: null,
    last_sequence_number: null,
    last_device_recorded_at: null,
    last_corrected_device_at: null,
    coverage_horizon_at: null,
    sequence_gap_events: 0,
    sequence_missing_records: 0,
    out_of_order_events: 0,
    reported_lost_records: 0,
    incomplete_metadata_events: 0,
    ...overrides,
  };
}

function sessionRow(overrides = {}) {
  return {
    connection_log_id: 31,
    client_id: 41,
    contract_id: 51,
    username: 'subscriber-1',
    radius_session_id: 'radius-1',
    session_instance_id: SESSION_INSTANCE_ID,
    ...overrides,
  };
}

function lifecycleDatabase({ exporterOverrides = {}, sessions = [sessionRow()] } = {}) {
  const state = {
    exporter: exporter(exporterOverrides),
    events: [],
    projections: [],
    exporterUpdates: [],
  };
  let nextProjectionId = 70;
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql, params = []) => {
      if (/SELECT \* FROM cgnat_exporter_configs/.test(sql)) return [[state.exporter]];
      if (/SELECT payload_hash, collector_api_token_id FROM cgnat_binding_events/.test(sql)) {
        return [state.events.filter(event => event.exporter_config_id === params[1]
          && event.exporter_boot_id === params[2] && event.event_id === params[3])];
      }
      if (/SELECT id FROM cgnat_binding_events/.test(sql)) {
        return [state.events.filter(event => event.exporter_config_id === params[1]
          && event.exporter_boot_id === params[2]).map(event => ({ id: event.id }))];
      }
      if (/SELECT id FROM cgnat_attribution_bindings[\s\S]*binding_key/.test(sql)) {
        return [state.projections.filter(row => row.exporter_config_id === params[1]
          && row.binding_key === params[2]).map(row => ({ id: row.id }))];
      }
      if (/SELECT cl\.id AS connection_log_id/.test(sql)) return [sessions];
      if (/FROM radius_accounting_events evidence/.test(sql)) {
        return [[{
          id: 61,
          event_at: new Date(params[3]),
          observed_at: new Date(params[4]),
          integrity_hash: 'a'.repeat(64),
        }]];
      }
      if (/INSERT INTO cgnat_public_tuple_locks/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT id FROM cgnat_public_tuple_locks/.test(sql)) return [[{ id: 1 }]];
      if (/SELECT id, allocated_at, released_at[\s\S]*FROM cgnat_attribution_bindings/.test(sql)) {
        return [[]];
      }
      if (/INSERT INTO cgnat_attribution_bindings/.test(sql)) {
        const projection = {
          id: ++nextProjectionId,
          exporter_config_id: Number(params[1]),
          binding_key: params[12],
        };
        state.projections.push(projection);
        return [{ insertId: projection.id, affectedRows: 1 }];
      }
      if (/INSERT INTO cgnat_binding_events/.test(sql)) {
        state.events.push({
          id: state.events.length + 1,
          binding_id: Number(params[1]),
          exporter_config_id: Number(params[2]),
          collector_api_token_id: Number(params[3]),
          event_type: params[4],
          binding_key: params[5],
          exporter_boot_id: params[7],
          event_id: params[8],
          sequence_number: Number(params[9]),
          sequence_status: params[10],
          device_recorded_at: params[11],
          payload_hash: params[17],
        });
        return [{ insertId: state.events.length, affectedRows: 1 }];
      }
      if (/UPDATE cgnat_exporter_configs/.test(sql)) {
        state.exporterUpdates.push({ sql, params });
        const advances = Number(params[0]) === 1;
        if (advances) {
          const corrected = new Date(params[1]);
          const currentCorrected = state.exporter.last_corrected_device_at
            ? new Date(state.exporter.last_corrected_device_at) : null;
          if (!currentCorrected || currentCorrected < corrected) {
            state.exporter.last_device_recorded_at = new Date(params[2]);
            state.exporter.last_corrected_device_at = new Date(params[5]);
          }
          const horizon = new Date(params[7]);
          const currentHorizon = state.exporter.coverage_horizon_at
            ? new Date(state.exporter.coverage_horizon_at) : null;
          if (!currentHorizon || currentHorizon < horizon) {
            state.exporter.coverage_horizon_at = new Date(params[8]);
          }
          state.exporter.last_exporter_boot_id = params[10];
          state.exporter.last_sequence_number = Number(params[12]);
        }
        state.exporter.sequence_gap_events += Number(params[13]);
        state.exporter.sequence_missing_records += Number(params[14]);
        state.exporter.out_of_order_events += Number(params[15]);
        state.exporter.reported_lost_records += Number(params[16] || 0);
        state.exporter.incomplete_metadata_events += Number(params[17]);
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO collector_ingest_receipts/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected clock lifecycle SQL: ${sql}`);
    }),
  };
  db.getConnection.mockResolvedValue(connection);
  return { state, connection };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('corrected device clock contract', () => {
  test.each([
    ['positive', 120000],
    ['negative', -120000],
  ])('normalizes a %s offset as raw device clock minus UTC', (_label, offset) => {
    const raw = isoAdd(UTC_EVENT, offset);
    const row = normalizeBinding(binding({
      device_recorded_at: raw,
      clock_offset_ms: offset,
      clock_uncertainty_ms: 1000,
    }));

    expect(row.device_recorded_at.toISOString()).toBe(raw);
    expect(row.corrected_device_at.toISOString()).toBe(UTC_EVENT);
    expect(row.coverage_horizon_at.toISOString()).toBe(isoAdd(UTC_EVENT, -1000));
  });

  test.each([
    ['positive', 120000],
    ['negative', -120000],
  ])('persists corrected/horizon high-watermarks for a %s offset instead of raw-clock coverage', async (_label, offset) => {
    const raw = isoAdd(UTC_EVENT, offset);
    const { state } = lifecycleDatabase();

    await expect(ingestBatch(ORGANIZATION_ID, { bindings: [binding({
      device_recorded_at: raw,
      clock_offset_ms: offset,
      clock_uncertainty_ms: 1000,
    })] }, { apiTokenId: 99 })).resolves.toMatchObject({ inserted: 1, allocated: 1 });

    expect(state.exporterUpdates).toHaveLength(1);
    const { sql, params } = state.exporterUpdates[0];
    expect(sql).toContain('last_corrected_device_at');
    expect(sql).toContain('coverage_horizon_at');
    expect(new Date(params[1]).toISOString()).toBe(UTC_EVENT);
    expect(new Date(params[2]).toISOString()).toBe(raw);
    expect(new Date(params[5]).toISOString()).toBe(UTC_EVENT);
    expect(new Date(params[7]).toISOString()).toBe(isoAdd(UTC_EVENT, -1000));
    expect(new Date(state.exporter.last_corrected_device_at).toISOString()).toBe(UTC_EVENT);
    expect(new Date(state.exporter.coverage_horizon_at).toISOString())
      .toBe(isoAdd(UTC_EVENT, -1000));
  });

  test('does not let a positive raw-clock offset bypass approval/baseline time', async () => {
    const { connection } = lifecycleDatabase({
      exporterOverrides: {
        collection_approved_at: isoAdd(UTC_EVENT, 60000),
        baseline_confirmed_at: isoAdd(UTC_EVENT, 60000),
      },
    });

    await expect(ingestBatch(ORGANIZATION_ID, { bindings: [binding({
      device_recorded_at: isoAdd(UTC_EVENT, 120000),
      clock_offset_ms: 120000,
      clock_uncertainty_ms: 0,
    })] }, { apiTokenId: 99 })).rejects.toThrow(/predates the approved collection purpose/);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.execute.mock.calls.some(([sql]) => (
      /INSERT INTO cgnat_attribution_bindings/.test(sql)
    ))).toBe(false);
  });

  test('orders a new boot by corrected UTC, not by a misleading positive raw timestamp', () => {
    const row = normalizeBinding(binding({
      exporter_boot_id: 'boot-b',
      device_recorded_at: isoAdd(UTC_EVENT, 120000),
      clock_offset_ms: 120000,
      clock_uncertainty_ms: 0,
    }));
    const result = sequenceState({
      last_exporter_boot_id: 'boot-a',
      last_corrected_device_at: isoAdd(UTC_EVENT, 30000),
    }, row);

    expect(result).toEqual({ status: 'out_of_order', missing: 0, advances: false });
  });

  test('does not mark a corrected-later new boot old merely because its negative-offset raw clock is earlier', () => {
    const corrected = isoAdd(UTC_EVENT, 60000);
    const row = normalizeBinding(binding({
      allocated_at: corrected,
      exporter_boot_id: 'boot-b',
      device_recorded_at: isoAdd(corrected, -120000),
      clock_offset_ms: -120000,
      clock_uncertainty_ms: 0,
    }));
    const result = sequenceState({
      last_exporter_boot_id: 'boot-a',
      last_corrected_device_at: UTC_EVENT,
    }, row);

    expect(result).toEqual({ status: 'gap', missing: 0, advances: false });
  });
});

describe('sequence and access-session fail-closed behavior through ingest', () => {
  test('records an arbitrary initial sequence as a persistent gap with exact missing count', async () => {
    const { state } = lifecycleDatabase();

    const result = await ingestBatch(ORGANIZATION_ID, {
      bindings: [binding({ sequence_number: 4 })],
    }, { apiTokenId: 99 });

    expect(result.sequence).toMatchObject({ gap: 1, initial: 0 });
    expect(state.events[0]).toMatchObject({ sequence_status: 'gap', sequence_number: 4 });
    expect(state.exporter).toMatchObject({
      sequence_gap_events: 1,
      sequence_missing_records: 3,
    });
  });

  test('keeps A to B to A reboot evidence faulted while preserving the last valid boot sequence', async () => {
    const { state } = lifecycleDatabase();
    const secondAt = isoAdd(UTC_EVENT, 60000);
    const thirdAt = isoAdd(UTC_EVENT, 120000);

    const result = await ingestBatch(ORGANIZATION_ID, { bindings: [
      binding(),
      binding({
        binding_key: 'binding-2', event_id: 'event-2', exporter_boot_id: 'boot-b',
        allocated_at: secondAt, device_recorded_at: secondAt,
        public_port_start: 45001, public_port_end: 45001,
      }),
      binding({
        binding_key: 'binding-3', event_id: 'event-3', exporter_boot_id: 'boot-a',
        sequence_number: 1, allocated_at: thirdAt, device_recorded_at: thirdAt,
        public_port_start: 45002, public_port_end: 45002,
      }),
    ] }, { apiTokenId: 99 });

    expect(result.sequence).toMatchObject({ initial: 1, gap: 1, contiguous: 1 });
    expect(state.events.map(event => event.sequence_status))
      .toEqual(['initial', 'gap', 'contiguous']);
    expect(state.exporter).toMatchObject({
      last_exporter_boot_id: 'boot-a',
      last_sequence_number: 1,
      sequence_gap_events: 1,
    });
  });

  test('rejects ambiguous access projections even with the canonical session identity', async () => {
    const { connection } = lifecycleDatabase({
      sessions: [sessionRow(), sessionRow({ connection_log_id: 32 })],
    });

    await expect(ingestBatch(ORGANIZATION_ID, {
      bindings: [binding()],
    }, { apiTokenId: 99 })).rejects.toThrow(/exactly one access session/);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('correlates private-IP reuse only through the same-org canonical session UUID', async () => {
    const { connection } = lifecycleDatabase();

    await ingestBatch(ORGANIZATION_ID, { bindings: [binding()] }, { apiTokenId: 99 });

    const sessionCall = connection.execute.mock.calls.find(([sql]) => (
      /SELECT cl\.id AS connection_log_id/.test(sql)
    ));
    expect(sessionCall[0]).toMatch(/cl\.organization_id = \?/);
    expect(sessionCall[0]).toMatch(/COALESCE\(cl\.framed_ip, cl\.ip_address\) = \?/);
    expect(sessionCall[0]).toMatch(/cl\.session_instance_id = \?/);
    expect(sessionCall[0]).toMatch(/LIMIT 2/);
    expect(sessionCall[1]).toEqual(expect.arrayContaining([
      ORGANIZATION_ID, '10.0.0.10', SESSION_INSTANCE_ID,
    ]));
  });

  test('anchors CGNAT allocation only to RADIUS event and receipt before its uncertainty bound', async () => {
    const { connection } = lifecycleDatabase();

    await ingestBatch(ORGANIZATION_ID, { bindings: [binding({
      clock_uncertainty_ms: 5000,
    })] }, { apiTokenId: 99 });

    const certainStart = new Date(isoAdd(UTC_EVENT, -5000));
    const possibleEnd = new Date(isoAdd(UTC_EVENT, 5000));
    const sessionCall = connection.execute.mock.calls.find(([sql]) => (
      /SELECT cl\.id AS connection_log_id/.test(sql)
    ));
    expect(sessionCall[1].slice(0, 6)).toEqual([
      ORGANIZATION_ID, '10.0.0.10', certainStart,
      possibleEnd, 900, possibleEnd,
    ]);

    const evidenceCall = connection.execute.mock.calls.find(([sql]) => (
      /FROM radius_accounting_events evidence/.test(sql)
    ));
    expect(evidenceCall[0]).toMatch(/evidence\.event_at <= \?/);
    expect(evidenceCall[0]).toMatch(/evidence\.observed_at <= \?/);
    expect(evidenceCall[0]).toMatch(
      /ORDER BY GREATEST\(evidence\.event_at, evidence\.observed_at\) DESC/,
    );
    expect(evidenceCall[1]).toEqual([
      ORGANIZATION_ID, SESSION_INSTANCE_ID, '10.0.0.10', certainStart, certainStart,
    ]);
  });
});

function requestCase(observedAt) {
  const row = {
    id: 81,
    organization_id: ORGANIZATION_ID,
    request_type: 'ip_traceability',
    status: 'processing',
    authority_name: 'Authority',
    authority_ref: 'AUTH-1',
    legal_basis: 'Exact source-tuple request',
    legal_reviewed_at: new Date('2026-07-31T00:00:00.000Z'),
    legal_reviewed_by: 1,
    client_id: null,
    contract_id: null,
    ip_address: '8.8.8.8',
    public_port: 45000,
    protocol: 'tcp',
    observed_at: new Date(observedAt),
    created_at: new Date('2026-07-31T00:00:00.000Z'),
  };
  row.row_hash = governmentRequestRowHash(row);
  return row;
}

function lookupBody(observedAt) {
  return {
    gov_data_request_id: 81,
    public_ipv4: '8.8.8.8',
    public_port: 45000,
    protocol: 'tcp',
    observed_at: observedAt,
  };
}

function retiredEpochCandidate(retiredAt) {
  const allocatedAt = new Date('2026-08-01T00:00:00.000Z');
  const receivedAt = new Date('2026-08-01T00:00:01.000Z');
  return {
    id: 71,
    binding_type: 'single_port',
    client_id: 41,
    client_name: 'Subscriber One',
    contract_id: 51,
    username: 'subscriber-1',
    radius_session_id: 'radius-1',
    session_instance_id: SESSION_INSTANCE_ID,
    connection_log_id: 31,
    radius_evidence_id: 61,
    radius_evidence_event_at: allocatedAt,
    radius_evidence_observed_at: allocatedAt,
    radius_evidence_integrity_hash: 'a'.repeat(64),
    private_ipv4: '10.0.0.10',
    private_port_start: 5000,
    private_port_end: 5000,
    public_ipv4: '8.8.8.8',
    public_port_start: 45000,
    public_port_end: 45000,
    protocol: 6,
    allocated_at: allocatedAt,
    released_at: null,
    exporter_id: 'edge-1',
    exporter_config_id: 7,
    exporter_public_ipv4_start: '8.8.8.1',
    exporter_public_ipv4_end: '8.8.8.254',
    exporter_purpose_reference: 'approved purpose',
    exporter_tuple_exclusivity_confirmed: 1,
    exporter_authoritative_baseline_confirmed: 1,
    exporter_baseline_reference: 'empty epoch 1',
    exporter_baseline_confirmed_by: 1,
    exporter_baseline_confirmed_at: new Date('2026-07-31T00:00:00.000Z'),
    exporter_collection_approved_by: 1,
    exporter_collection_approved_at: new Date('2026-07-31T00:00:00.000Z'),
    exporter_epoch_created_at: new Date('2026-07-31T00:00:00.000Z'),
    exporter_epoch_retired_at: new Date(retiredAt),
    exporter_last_device_recorded_at: new Date('2026-08-01T00:50:00.000Z'),
    exporter_last_corrected_device_at: new Date('2026-08-01T00:50:00.000Z'),
    exporter_coverage_horizon_at: new Date('2026-08-01T00:50:00.000Z'),
    exporter_sequence_gap_events: 0,
    exporter_sequence_missing_records: 0,
    exporter_out_of_order_events: 0,
    exporter_reported_lost_records: 0,
    exporter_incomplete_metadata_events: 0,
    collector_api_token_id: 99,
    exporter_boot_id: 'boot-a',
    nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1',
    nat_realm: 'internet',
    allocation_event_id: 'allocate-1',
    allocation_event_integrity_hash: 'b'.repeat(64),
    allocation_sequence_number: 0,
    allocation_sequence_status: 'initial',
    allocation_device_recorded_at: allocatedAt,
    allocation_received_at: receivedAt,
    release_event_id: null,
    release_event_integrity_hash: null,
    release_sequence_number: null,
    release_sequence_status: null,
    release_device_recorded_at: null,
    release_received_at: null,
    allocation_clock_offset_ms: 0,
    allocation_clock_uncertainty_ms: 0,
    allocation_records_lost_before: 0,
    release_clock_offset_ms: null,
    release_clock_uncertainty_ms: null,
    release_records_lost_before: null,
    metadata_complete: 1,
    access_session_event_type: 'interim-update',
    access_session_last_accounting_at: new Date('2026-08-01T00:50:00.000Z'),
    access_session_last_accounting_received_at: new Date('2026-08-01T00:50:00.000Z'),
    access_session_stop_evidence_id: null,
    access_session_stop_event_at: null,
    access_session_stop_integrity_hash: null,
    integrity_hash: 'e'.repeat(64),
  };
}

describe('historical exporter epoch retirement boundary', () => {
  test.each([
    ['before retirement', '2026-08-01T00:44:59.999Z', 'matched', null],
    ['at retirement', '2026-08-01T00:45:00.000Z', 'unavailable',
      'candidate_exporter_evidence_incomplete'],
    ['after retirement', '2026-08-01T00:45:00.001Z', 'unavailable',
      'candidate_exporter_evidence_incomplete'],
  ])('allows a clean retired epoch only %s', async (_label, observedAt, status, reason) => {
    const retiredAt = '2026-08-01T00:45:00.000Z';
    const candidate = retiredEpochCandidate(retiredAt);
    db.query.mockImplementation(async (sql, params = []) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase(observedAt)]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) return [[candidate]];
      if (/SELECT config\.id/.test(sql)) {
        const cleanHistoricalEpoch = new Date(retiredAt).getTime()
          > new Date(params[6]).getTime();
        return [[{ id: 7, healthy: cleanHistoricalEpoch ? 1 : 0 }]];
      }
      if (/SELECT COUNT\(\*\) AS total/.test(sql)) {
        const cleanHistoricalEpoch = new Date(retiredAt).getTime()
          > new Date(params[2]).getTime();
        return [[{
          total: cleanHistoricalEpoch ? 1 : 0,
          healthy: cleanHistoricalEpoch ? 1 : 0,
        }]];
      }
      throw new Error(`Unexpected retired-epoch lookup SQL: ${sql}`);
    });

    const result = await lookupAttribution(
      ORGANIZATION_ID, lookupBody(observedAt), { pin: false },
    );

    expect(result).toMatchObject({ status, reason, candidate_count: 1 });
    const candidateHealthCall = db.query.mock.calls.find(([sql]) => /SELECT config\.id/.test(sql));
    expect(candidateHealthCall[0]).toMatch(
      /config\.retired_at IS NULL OR config\.retired_at > \?/,
    );
    expect(new Date(candidateHealthCall[1][6]).toISOString()).toBe(observedAt);
    if (status === 'matched') {
      expect(result).toMatchObject({
        attributionMethod: 'cgnat_binding',
        attribution: { exporter_epoch_retired_at: retiredAt },
      });
    }
  });
});
