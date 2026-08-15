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
  ingestBatch, lookupAttribution,
} = require('../src/services/cgnatAttributionService');
const { governmentRequestRowHash } = require('../src/utils/govDataRequestIntegrity');

const ALLOCATED = '2026-08-01T00:00:00.000Z';
const RELEASED = '2026-08-01T01:00:00.000Z';
const OBSERVED = '2026-08-01T00:30:00.000Z';

function binding(overrides = {}) {
  return {
    event_type: 'allocate', binding_key: 'binding-1', binding_type: 'single_port',
    private_ipv4: '10.0.0.10', private_port_start: 5000, private_port_end: 5000,
    public_ipv4: '8.8.8.8', public_port_start: 45000, public_port_end: 45000,
    protocol: 'tcp', allocated_at: ALLOCATED, released_at: null,
    session_instance_id: '11111111-1111-4111-8111-111111111111',
    exporter_id: 'edge-1', exporter_ip: null, exporter_boot_id: 'boot-a',
    nat_instance_id: 'nat-1', nat_pool_id: 'pool-1', nat_realm: 'internet',
    event_id: 'allocate-1', sequence_number: 0, device_recorded_at: ALLOCATED,
    clock_offset_ms: 0, clock_uncertainty_ms: 0, records_lost_before: 0,
    ...overrides,
  };
}

function release(overrides = {}) {
  return binding({
    event_type: 'release', released_at: RELEASED, event_id: 'release-1',
    sequence_number: 1, device_recorded_at: RELEASED, ...overrides,
  });
}

function exporter(overrides = {}) {
  return {
    id: 7, organization_id: 10, collector_api_token_id: 99,
    exporter_id: 'edge-1', exporter_nas_id: null, exporter_ip: null,
    nat_instance_id: 'nat-1', nat_pool_id: 'pool-1', nat_realm: 'internet',
    public_ipv4_start: '8.8.8.1', public_ipv4_end: '8.8.8.254',
    enabled: 1, is_required: 1, purpose_reference: 'approved purpose',
    collection_approved_at: '2026-07-31T00:00:00.000Z',
    authoritative_baseline_confirmed: 1, baseline_reference: 'empty epoch 1',
    baseline_confirmed_at: '2026-07-31T00:00:00.000Z',
    last_exporter_boot_id: null, last_sequence_number: null,
    last_device_recorded_at: null,
    ...overrides,
  };
}

function fakeIngestDatabase({ exporterOverrides = {}, overlap = false } = {}) {
  const state = { exporter: exporter(exporterOverrides), events: [], projection: null };
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
      if (/SELECT id FROM cgnat_attribution_bindings/.test(sql)) {
        return [state.projection && state.projection.binding_key === params[2]
          ? [{ id: state.projection.id }] : []];
      }
      if (/SELECT cl\.id AS connection_log_id/.test(sql)) {
        return [[{ connection_log_id: 31, client_id: 41, contract_id: 51,
          username: 'subscriber-1', radius_session_id: 'radius-1',
          session_instance_id: '11111111-1111-4111-8111-111111111111' }]];
      }
      if (/FROM radius_accounting_events evidence/.test(sql)) {
        return [[{ id: 61, event_at: new Date(ALLOCATED), observed_at: new Date(ALLOCATED),
          integrity_hash: 'a'.repeat(64) }]];
      }
      if (/INSERT INTO cgnat_public_tuple_locks/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT id FROM cgnat_public_tuple_locks/.test(sql)) return [[{ id: 1 }]];
      if (/SELECT id, allocated_at, released_at[\s\S]*FROM cgnat_attribution_bindings/.test(sql)) {
        return [overlap ? [{ id: 999, allocated_at: ALLOCATED, released_at: null }] : []];
      }
      if (/INSERT INTO cgnat_attribution_bindings/.test(sql)) {
        state.projection = {
          id: 71, organization_id: 10, exporter_config_id: 7, connection_log_id: 31,
          client_id: 41, contract_id: 51, username: 'subscriber-1',
          radius_session_id: 'radius-1',
          session_instance_id: '11111111-1111-4111-8111-111111111111',
          radius_evidence_id: 61, radius_evidence_event_at: new Date(ALLOCATED),
          radius_evidence_observed_at: new Date(ALLOCATED),
          radius_evidence_integrity_hash: 'a'.repeat(64), binding_key: 'binding-1',
          binding_type: 'single_port', private_ipv4: '10.0.0.10',
          private_port_start: 5000, private_port_end: 5000, public_ipv4: '8.8.8.8',
          public_port_start: 45000, public_port_end: 45000, protocol: 6,
          allocated_at: new Date(ALLOCATED), released_at: null,
          nat_instance_id: 'nat-1', nat_pool_id: 'pool-1', nat_realm: 'internet',
        };
        return [{ insertId: 71, affectedRows: 1 }];
      }
      if (/SELECT \* FROM cgnat_attribution_bindings/.test(sql)) {
        return [state.projection ? [state.projection] : []];
      }
      if (/SELECT cl\.id[\s\S]*FROM connection_logs cl/.test(sql)) {
        return [[{ id: 31 }]];
      }
      if (/UPDATE cgnat_attribution_bindings/.test(sql)) {
        if (!state.projection || state.projection.released_at) return [{ affectedRows: 0 }];
        state.projection.released_at = params[0];
        state.projection.release_event_id = params[1];
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO cgnat_binding_events/.test(sql)) {
        state.events.push({
          id: state.events.length + 1, binding_id: params[1], exporter_config_id: params[2],
          collector_api_token_id: params[3], event_type: params[4],
          exporter_boot_id: params[7], event_id: params[8], payload_hash: params[17],
        });
        return [{ insertId: state.events.length, affectedRows: 1 }];
      }
      if (/UPDATE cgnat_exporter_configs/.test(sql)) {
        if (params[9]) state.exporter.last_exporter_boot_id = params[10];
        if (params[11]) state.exporter.last_sequence_number = params[12];
        state.exporter.last_device_recorded_at = params[2];
        state.exporter.last_corrected_device_at = params[5];
        state.exporter.coverage_horizon_at = params[8];
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO collector_ingest_receipts/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected ingest SQL: ${sql}`);
    }),
  };
  db.getConnection.mockResolvedValue(connection);
  return { state, connection };
}

function requestCase(overrides = {}) {
  const row = {
    id: 81, organization_id: 10, request_type: 'ip_traceability', status: 'processing',
    authority_name: 'Authority', authority_ref: 'AUTH-1', legal_basis: 'Exact request',
    legal_reviewed_at: '2026-07-31T00:00:00.000Z', legal_reviewed_by: 1,
    client_id: null, contract_id: null, ip_address: '8.8.8.8', public_port: 45000,
    protocol: 'tcp', observed_at: new Date(OBSERVED),
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    ...overrides,
  };
  row.row_hash = governmentRequestRowHash(row);
  return row;
}

function lookupBody(overrides = {}) {
  return { gov_data_request_id: 81, public_ipv4: '8.8.8.8', public_port: 45000,
    protocol: 'tcp', observed_at: OBSERVED, ...overrides };
}

function directRow(overrides = {}) {
  return {
    connection_log_id: 31, client_id: 41, contract_id: 51, username: 'subscriber-1',
    radius_session_id: 'radius-1', session_instance_id: 'session-instance-1',
    public_ipv4: '8.8.8.8', assigned_at: new Date(ALLOCATED),
    assignment_evidence_id: 61, assignment_evidence_event_at: new Date(ALLOCATED),
    assignment_evidence_received_at: new Date(ALLOCATED),
    assignment_evidence_integrity_hash: 'a'.repeat(64), closure_evidence_id: null,
    released_at: null, closure_evidence_received_at: null,
    closure_evidence_integrity_hash: null, last_accounting_received_at: new Date(OBSERVED),
    last_accounting_at: new Date(OBSERVED),
    client_name: 'Subscriber One', ...overrides,
  };
}

function cgnatRow(overrides = {}) {
  return {
    id: 71, binding_type: 'single_port', client_id: 41, client_name: 'Subscriber One',
    contract_id: 51, username: 'subscriber-1', radius_session_id: 'radius-1',
    session_instance_id: '11111111-1111-4111-8111-111111111111',
    connection_log_id: 31, radius_evidence_id: 61,
    radius_evidence_event_at: new Date(ALLOCATED),
    radius_evidence_observed_at: new Date(ALLOCATED),
    radius_evidence_integrity_hash: 'a'.repeat(64),
    private_ipv4: '10.0.0.10', private_port_start: 5000, private_port_end: 5000,
    public_ipv4: '8.8.8.8', public_port_start: 45000, public_port_end: 45000,
    protocol: 6, allocated_at: new Date(ALLOCATED), released_at: new Date(RELEASED),
    exporter_id: 'edge-1', exporter_config_id: 7,
    exporter_public_ipv4_start: '8.8.8.1', exporter_public_ipv4_end: '8.8.8.254',
    exporter_purpose_reference: 'approved purpose', exporter_tuple_exclusivity_confirmed: 1,
    exporter_authoritative_baseline_confirmed: 1, exporter_baseline_reference: 'empty epoch 1',
    exporter_baseline_confirmed_by: 1,
    exporter_baseline_confirmed_at: new Date('2026-07-31T00:00:00.000Z'),
    exporter_collection_approved_by: 1,
    exporter_collection_approved_at: new Date('2026-07-31T00:00:00.000Z'),
    exporter_epoch_created_at: new Date('2026-07-31T00:00:00.000Z'),
    exporter_epoch_retired_at: null, exporter_sequence_gap_events: 0,
    exporter_last_device_recorded_at: new Date(RELEASED),
    exporter_last_corrected_device_at: new Date(RELEASED),
    exporter_coverage_horizon_at: new Date(RELEASED),
    exporter_sequence_missing_records: 0, exporter_out_of_order_events: 0,
    exporter_reported_lost_records: 0, exporter_incomplete_metadata_events: 0,
    collector_api_token_id: 99, exporter_boot_id: 'boot-a', nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1', nat_realm: 'internet', allocation_event_id: 'allocate-1',
    allocation_event_integrity_hash: 'b'.repeat(64), allocation_sequence_number: 0,
    allocation_sequence_status: 'initial', allocation_device_recorded_at: new Date(ALLOCATED),
    allocation_received_at: new Date(ALLOCATED), release_event_id: 'release-1',
    release_event_integrity_hash: 'c'.repeat(64), release_sequence_number: 1,
    release_sequence_status: 'contiguous', release_device_recorded_at: new Date(RELEASED),
    release_received_at: new Date(RELEASED), allocation_clock_offset_ms: 0,
    allocation_clock_uncertainty_ms: 0, allocation_records_lost_before: 0,
    release_clock_offset_ms: 0, release_clock_uncertainty_ms: 0,
    release_records_lost_before: 0, metadata_complete: 1,
    access_session_event_type: 'stop', access_session_last_accounting_at: new Date(RELEASED),
    access_session_last_accounting_received_at: new Date(RELEASED),
    access_session_stop_evidence_id: 62, access_session_stop_event_at: new Date(RELEASED),
    access_session_stop_observed_at: new Date(RELEASED),
    access_session_stop_integrity_hash: 'd'.repeat(64), integrity_hash: 'e'.repeat(64),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CGNAT allocation lifecycle with immutable receipts', () => {
  test('allocates, exact-replays, then closes the same active projection', async () => {
    const { state, connection } = fakeIngestDatabase();
    const first = await ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 99 });
    const replayed = await ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 99 });
    const closed = await ingestBatch(10, { bindings: [release()] }, { apiTokenId: 99 });

    expect(first).toMatchObject({ inserted: 1, replayed: 0, allocated: 1, released: 0 });
    expect(replayed).toMatchObject({ inserted: 0, replayed: 1, allocated: 0 });
    expect(closed).toMatchObject({ inserted: 1, released: 1 });
    expect(state.events.map(event => event.event_type)).toEqual(['allocate', 'release']);
    expect(new Date(state.projection.released_at).toISOString()).toBe(RELEASED);
    for (const [sql, params] of connection.execute.mock.calls.filter(([sql]) => (
      /(?:INSERT INTO|UPDATE) cgnat_(?:attribution_bindings|binding_events|exporter_configs)/.test(sql)
    ))) {
      expect((sql.match(/\?/g) || [])).toHaveLength(params.length);
    }
    expect(connection.commit).toHaveBeenCalledTimes(3);
  });

  test('rejects an overlapping source tuple without destination-based disambiguation', async () => {
    const { state, connection } = fakeIngestDatabase({ overlap: true });
    await expect(ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 99 }))
      .rejects.toThrow(/overlaps an existing subscriber allocation/);
    expect(state.events).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('rejects release identity hints that differ from the allocation', async () => {
    const { state, connection } = fakeIngestDatabase();
    await ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 99 });
    await expect(ingestBatch(10, { bindings: [release({ client_id: 999 })] }, { apiTokenId: 99 }))
      .rejects.toThrow(/does not match the stored allocation/);
    expect(state.projection.released_at).toBeNull();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('rejects a collector token not frozen to the exporter epoch', async () => {
    fakeIngestDatabase();
    await expect(ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 100 }))
      .rejects.toThrow(/not bound to this CGNAT exporter/);
  });

  test('rejects delayed evidence that predates approval or baseline', async () => {
    fakeIngestDatabase({ exporterOverrides: {
      collection_approved_at: '2026-08-01T00:00:01.000Z',
      baseline_confirmed_at: '2026-08-01T00:00:01.000Z',
    } });
    await expect(ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 99 }))
      .rejects.toThrow(/predates the approved collection purpose/);
  });

  test('lets an approved recovery token close existing mappings but never allocate', async () => {
    const { state } = fakeIngestDatabase();
    await ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 99 });
    Object.assign(state.exporter, {
      recovery_collector_api_token_id: 100,
      recovery_reference: 'INC-1',
      recovery_approved_at: '2026-08-01T00:30:00.000Z',
      incomplete_metadata_events: 1,
    });

    await expect(ingestBatch(10, { bindings: [release()] }, { apiTokenId: 100 }))
      .resolves.toMatchObject({ released: 1 });
    expect(state.events.at(-1)).toMatchObject({
      event_type: 'release', collector_api_token_id: 100,
    });

    const another = fakeIngestDatabase({ exporterOverrides: {
      recovery_collector_api_token_id: 100,
      recovery_reference: 'INC-2',
      recovery_approved_at: '2026-08-01T00:30:00.000Z',
    } });
    await expect(ingestBatch(10, { bindings: [binding()] }, { apiTokenId: 100 }))
      .rejects.toThrow(/release events only/);
    expect(another.state.events).toHaveLength(0);
  });
});

describe('case-bound lookup method and candidate boundaries', () => {
  test('a full tuple searches CGNAT only and never substitutes a direct assignment', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase()]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) return [[]];
      if (/FROM connection_logs cl/.test(sql)) throw new Error('direct query must not run');
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    await expect(lookupAttribution(10, lookupBody(), { pin: false }))
      .resolves.toMatchObject({ status: 'unavailable', candidate_count: 0 });
  });

  test('a tuple-less case searches direct assignments only', async () => {
    const directCase = requestCase({ public_port: null, protocol: null });
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[directCase]];
      if (/FROM connection_logs cl/.test(sql)) return [[]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) {
        throw new Error('CGNAT query must not run');
      }
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    await expect(lookupAttribution(10, lookupBody({ public_port: undefined,
      protocol: undefined }), { pin: false }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'no_direct_assignment' });
  });

  test('reports the exact count when more than three candidates overlap', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase()]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) {
        return [[1, 2, 3, 4].map(id => ({ id }))];
      }
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    const result = await lookupAttribution(10, lookupBody(), { pin: false });
    expect(result).toMatchObject({ status: 'ambiguous', candidate_count: 4,
      reason: 'multiple_attribution_candidates' });
    expect(db.query.mock.calls.find(([sql]) => /FROM cgnat_attribution_bindings binding/.test(sql))[0])
      .not.toMatch(/LIMIT\s+3/i);
  });

  test('rejects a direct candidate outside the approved case subject', async () => {
    const directCase = requestCase({ public_port: null, protocol: null, client_id: 999 });
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[directCase]];
      if (/FROM connection_logs cl/.test(sql)) return [[directRow()]];
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    await expect(lookupAttribution(10, lookupBody({ public_port: undefined,
      protocol: undefined }), { pin: false })).rejects.toThrow(/approved case subject/);
  });

  test('fails a processing case closed when its stored scope hash was changed', async () => {
    const changed = requestCase();
    changed.authority_ref = 'CHANGED';
    db.query.mockResolvedValueOnce([[changed]]);
    await expect(lookupAttribution(10, lookupBody(), { pin: false }))
      .rejects.toThrow(/consistency marker/);
  });

  test('returns a CGNAT match only with certain interval and healthy unique epoch coverage', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase()]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) return [[cgnatRow()]];
      if (/SELECT config\.id/.test(sql)) return [[{ id: 7, healthy: 1 }]];
      if (/SELECT COUNT\(\*\) AS total/.test(sql)) return [[{ total: 1, healthy: 1 }]];
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    const result = await lookupAttribution(10, lookupBody(), { pin: false });
    expect(result).toMatchObject({ status: 'matched', candidate_count: 1,
      attributionMethod: 'cgnat_binding', attribution: {
        binding_id: 71, client_id: 41, radius_evidence_id: 61,
        allocation_event_integrity_hash: 'b'.repeat(64),
        release_event_integrity_hash: 'c'.repeat(64),
        access_session_stop_evidence_id: 62,
      } });
  });

  test('does not make a positive claim within an allocation clock boundary', async () => {
    const boundaryObserved = '2026-08-01T00:00:00.500Z';
    const boundaryCase = requestCase({ observed_at: new Date(boundaryObserved) });
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[boundaryCase]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) {
        return [[cgnatRow({ allocation_clock_uncertainty_ms: 1000 })]];
      }
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    const result = await lookupAttribution(10, lookupBody({ observed_at: boundaryObserved }),
      { pin: false });
    expect(result).toMatchObject({ status: 'unavailable', candidate_count: 1,
      reason: 'clock_boundary_uncertainty' });
  });

  test('does not let a healthy replacement epoch heal a faulted candidate epoch', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[requestCase()]];
      if (/FROM cgnat_attribution_bindings binding/.test(sql)) return [[cgnatRow()]];
      if (/SELECT config\.id/.test(sql)) return [[{ id: 7, healthy: 0 }]];
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    const result = await lookupAttribution(10, lookupBody(), { pin: false });
    expect(result).toMatchObject({ status: 'unavailable',
      reason: 'candidate_exporter_evidence_incomplete' });
  });

  test('direct SQL anchors the queried IP and uses a strict half-open Stop boundary', async () => {
    const directCase = requestCase({ public_port: null, protocol: null });
    db.query.mockImplementation(async (sql) => {
      if (/FROM gov_data_requests/.test(sql)) return [[directCase]];
      if (/FROM connection_logs cl/.test(sql)) return [[]];
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    const result = await lookupAttribution(10, lookupBody({ public_port: undefined,
      protocol: undefined }), { pin: false });
    expect(result.status).toBe('unavailable');
    const [directSql] = db.query.mock.calls.find(([sql]) => /FROM connection_logs cl/.test(sql));
    expect(directSql).toMatch(/assignment_pick\.framed_ip = \?/);
    expect(directSql).toMatch(/closure_evidence\.event_at > \?/);
    expect(directSql).toMatch(/last_accounting_received_at >= DATE_SUB/);
  });

  test('pins exact replay once while preserving a new immutable version after Stop', async () => {
    const directCase = requestCase({ public_port: null, protocol: null });
    let current = directRow();
    const storedKeys = new Set();
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM gov_data_requests/.test(sql)) return [[directCase]];
      if (/FROM connection_logs cl/.test(sql)) return [[current]];
      if (/INSERT INTO ip_attribution_case_evidence/.test(sql)) {
        storedKeys.add(`${params[1]}:${params[2]}:${params[7]}:${params[8]}`);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected lookup SQL: ${sql}`);
    });
    const body = lookupBody({ public_port: undefined, protocol: undefined });
    const first = await lookupAttribution(10, body, { actorId: 1 });
    const replayed = await lookupAttribution(10, body, { actorId: 1 });
    current = directRow({ closure_evidence_id: 62, released_at: new Date(RELEASED),
      closure_evidence_received_at: new Date(RELEASED),
      closure_evidence_integrity_hash: 'f'.repeat(64) });
    const stopped = await lookupAttribution(10, body, { actorId: 1 });
    expect(replayed.evidence_snapshot_hash).toBe(first.evidence_snapshot_hash);
    expect(stopped.evidence_snapshot_hash).not.toBe(first.evidence_snapshot_hash);
    expect(storedKeys.size).toBe(2);
  });
});
