'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));

jest.mock('../src/models/User', () => ({ getPermissions: jest.fn() }));
jest.mock('../src/services/orgPrincipalService', () => ({ resolveOrgPrincipal: jest.fn() }));

const db = require('../src/config/database');
const User = require('../src/models/User');
const { resolveOrgPrincipal } = require('../src/services/orgPrincipalService');
const {
  saveExporterConfig,
  listExporterConfigs,
  approveReleaseRecovery,
} = require('../src/services/cgnatAttributionService');

const ORGANIZATION_ID = 10;
const APPROVER_ID = 42;

function configBody(overrides = {}) {
  return {
    exporter_id: 'edge-1',
    exporter_nas_id: null,
    exporter_ip: null,
    nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1',
    nat_pool_record_id: 5,
    nat_realm: 'internet',
    purpose_reference: 'approved source-attribution policy REF-1',
    tuple_exclusivity_confirmed: true,
    authoritative_baseline_confirmed: true,
    baseline_reference: 'authoritative empty-state snapshot SNAP-1',
    collector_api_token_id: 99,
    is_required: true,
    enabled: true,
    ...overrides,
  };
}

function existingConfig(overrides = {}) {
  return {
    id: 7,
    organization_id: ORGANIZATION_ID,
    exporter_id: 'edge-1',
    exporter_nas_id: null,
    exporter_ip: null,
    nat_instance_id: 'nat-1',
    nat_pool_id: 'pool-1',
    nat_pool_record_id: 5,
    nat_realm: 'internet',
    collector_api_token_id: 99,
    public_ipv4_start: '8.8.8.1',
    public_ipv4_end: '8.8.8.254',
    purpose_reference: 'approved source-attribution policy REF-1',
    tuple_exclusivity_confirmed: 1,
    authoritative_baseline_confirmed: 1,
    baseline_reference: 'authoritative empty-state snapshot SNAP-1',
    collection_approved_by: APPROVER_ID,
    collection_approved_at: new Date('2026-07-31T00:00:00.000Z'),
    baseline_confirmed_by: APPROVER_ID,
    baseline_confirmed_at: new Date('2026-07-31T00:00:00.000Z'),
    is_required: 1,
    enabled: 1,
    retired_at: null,
    retired_by: null,
    ...overrides,
  };
}

function configDatabase({
  existing = null,
  evidenceCount = 0,
  openBindings = 0,
  overlappingConfig = false,
  duplicateTokenOwner = false,
  tokenRows = [{ id: 99, user_id: 50 }],
  poolRows = [{ id: 5, external_ip_start: '8.8.8.1', external_ip_end: '8.8.8.254' }],
  nasRows = [{ id: 3, ip_address: '1.1.1.1' }],
  saved = null,
} = {}) {
  const writes = [];
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql, params = []) => {
      if (/SELECT id FROM organizations/.test(sql)) return [[{ id: ORGANIZATION_ID }]];
      if (/SELECT \* FROM cgnat_exporter_configs[\s\S]*LIMIT 1 FOR UPDATE/.test(sql)) {
        return [existing ? [existing] : []];
      }
      if (/SELECT id, ip_address FROM nas/.test(sql)) return [nasRows];
      if (/SELECT id, external_ip_start, external_ip_end FROM nat_pools/.test(sql)) {
        return [poolRows];
      }
      if (/SELECT id FROM cgnat_exporter_configs[\s\S]*collector_api_token_id/.test(sql)) {
        return [duplicateTokenOwner ? [{ id: 8 }] : []];
      }
      if (/SELECT COUNT\(\*\) AS total FROM cgnat_binding_events/.test(sql)) {
        return [[{ total: evidenceCount }]];
      }
      if (/SELECT COUNT\(\*\) AS total FROM cgnat_attribution_bindings/.test(sql)) {
        return [[{ total: openBindings }]];
      }
      if (/SELECT id FROM cgnat_exporter_configs[\s\S]*INET_ATON/.test(sql)) {
        return [overlappingConfig ? [{ id: 8 }] : []];
      }
      if (/^(?:\s*)(?:INSERT INTO|UPDATE) cgnat_exporter_configs/.test(sql)) {
        writes.push({ sql, params });
        return [{ insertId: 7, affectedRows: 1 }];
      }
      if (/SELECT \* FROM cgnat_exporter_configs/.test(sql)) {
        return [[saved || existing || existingConfig()]];
      }
      throw new Error(`Unexpected exporter config SQL: ${sql}`);
    }),
  };
  db.getConnection.mockResolvedValue(connection);
  db.query.mockImplementation(async (sql) => {
    if (/FROM api_tokens/.test(sql)) return [tokenRows];
    throw new Error(`Unexpected primary config SQL: ${sql}`);
  });
  return { connection, writes };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.withPrimaryContext.mockImplementation(callback => callback());
  resolveOrgPrincipal.mockResolvedValue({ id: 50 });
  User.getPermissions.mockResolvedValue(['cgnat_attribution.ingest']);
});

describe('saveExporterConfig evidence-epoch lifecycle', () => {
  test('serializes approval by organization and freezes baseline/token/purpose provenance', async () => {
    const { connection, writes } = configDatabase();

    const result = await saveExporterConfig(ORGANIZATION_ID, configBody(), {
      approvalActorId: APPROVER_ID,
    });

    expect(result).toMatchObject({ id: 7, enabled: true, is_required: true });
    expect(result).not.toHaveProperty('organization_id');
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls[0]).toEqual([
      'SELECT id FROM organizations WHERE id = ? FOR UPDATE', [ORGANIZATION_ID],
    ]);

    const tokenCall = db.query.mock.calls.find(([sql]) => /FROM api_tokens/.test(sql));
    expect(tokenCall[0]).toMatch(/organization_id = \?/);
    expect(tokenCall[0]).toMatch(/JSON_LENGTH\(scopes\) = 1/);
    expect(tokenCall[0]).toContain("= 'cgnat_attribution:ingest'");
    expect(tokenCall[1]).toEqual([99, ORGANIZATION_ID]);
    expect(resolveOrgPrincipal).toHaveBeenCalledWith(
      { id: 50 }, ORGANIZATION_ID, { allowOperator: false },
    );
    expect(User.getPermissions).toHaveBeenCalledWith(50, ORGANIZATION_ID);

    expect(writes).toHaveLength(1);
    const insert = writes[0];
    expect(insert.sql).toMatch(/^\s*INSERT INTO cgnat_exporter_configs/);
    expect(insert.params).toEqual([
      ORGANIZATION_ID, 'edge-1', null, null, 'nat-1', 'pool-1', 5, 99,
      '8.8.8.1', '8.8.8.254', 'internet',
      'approved source-attribution policy REF-1', 1, 1,
      'authoritative empty-state snapshot SNAP-1',
      APPROVER_ID, 1, APPROVER_ID, 1, 1, 1,
    ]);
  });

  test('rejects a collector token unless it is an active same-org exact-scope principal', async () => {
    const { connection } = configDatabase({ tokenRows: [] });

    await expect(saveExporterConfig(ORGANIZATION_ID, configBody(), {
      approvalActorId: APPROVER_ID,
    })).rejects.toThrow(/active same-organization exact-scope/);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('rejects overlapping enabled public pool inventory before saving', async () => {
    const { connection, writes } = configDatabase({ overlappingConfig: true });

    await expect(saveExporterConfig(ORGANIZATION_ID, configBody(), {
      approvalActorId: APPROVER_ID,
    })).rejects.toThrow(/overlaps another configured NAT pool/);

    expect(writes).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    const overlapCall = connection.execute.mock.calls.find(([sql]) => (
      /SELECT id FROM cgnat_exporter_configs[\s\S]*INET_ATON/.test(sql)
    ));
    expect(overlapCall[0]).toMatch(/organization_id = \?/);
    expect(overlapCall[1][0]).toBe(ORGANIZATION_ID);
  });

  test('rejects reuse of one collector token across exporter evidence epochs', async () => {
    const { connection, writes } = configDatabase({ duplicateTokenOwner: true });

    await expect(saveExporterConfig(ORGANIZATION_ID, configBody(), {
      approvalActorId: APPROVER_ID,
    })).rejects.toThrow(/token may be bound to only one exporter evidence epoch/);

    expect(writes).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    const ownerCall = connection.execute.mock.calls.find(([sql]) => (
      /collector_api_token_id = \? OR recovery_collector_api_token_id = \?/.test(sql)
    ));
    expect(ownerCall[0]).toMatch(/organization_id = \?/);
    expect(ownerCall[1]).toEqual([ORGANIZATION_ID, 0, 99, 99]);
  });

  test('makes evidentiary fields immutable after the first accepted event', async () => {
    const { connection, writes } = configDatabase({
      existing: existingConfig(),
      evidenceCount: 1,
    });

    await expect(saveExporterConfig(ORGANIZATION_ID, configBody({
      purpose_reference: 'silently changed purpose',
    }), { approvalActorId: APPROVER_ID })).rejects.toThrow(/evidentiary fields are immutable/);

    expect(writes).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('refuses retirement while an allocation in that epoch remains open', async () => {
    const { connection, writes } = configDatabase({
      existing: existingConfig(),
      evidenceCount: 2,
      openBindings: 1,
    });

    await expect(saveExporterConfig(ORGANIZATION_ID, configBody({
      enabled: false,
      is_required: false,
    }), { approvalActorId: APPROVER_ID })).rejects.toThrow(/Close all active allocations/);

    expect(db.withPrimaryContext).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('retires a drained epoch from its frozen snapshot even if live token/pool inventory is gone', async () => {
    const { connection, writes } = configDatabase({
      existing: existingConfig(),
      evidenceCount: 2,
      openBindings: 0,
      tokenRows: [],
      poolRows: [],
    });

    await expect(saveExporterConfig(ORGANIZATION_ID, configBody({
      exporter_nas_id: 999,
      exporter_ip: '9.9.9.9',
      nat_pool_record_id: 999,
      collector_api_token_id: 999,
      purpose_reference: 'request value must not replace frozen evidence',
      enabled: false,
      is_required: false,
    }), { approvalActorId: APPROVER_ID })).resolves.toMatchObject({ id: 7 });

    expect(db.withPrimaryContext).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/^\s*UPDATE cgnat_exporter_configs/);
    expect(writes[0].params).toEqual([
      0, 0, 1, 1, APPROVER_ID, 7, ORGANIZATION_ID,
    ]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('never re-enables a retired evidence epoch', async () => {
    const { connection, writes } = configDatabase({
      existing: existingConfig({
        enabled: 0,
        is_required: 0,
        retired_at: new Date('2026-08-10T00:00:00.000Z'),
        retired_by: APPROVER_ID,
      }),
      evidenceCount: 2,
    });

    await expect(saveExporterConfig(ORGANIZATION_ID, configBody(), {
      approvalActorId: APPROVER_ID,
    })).rejects.toThrow(/cannot be re-enabled/);

    expect(writes).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});

describe('listExporterConfigs tenant boundary', () => {
  test('returns only rows selected through the explicit organization predicate', async () => {
    db.query.mockResolvedValueOnce([[existingConfig()]]);

    const rows = await listExporterConfigs(ORGANIZATION_ID);

    expect(rows).toHaveLength(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/FROM cgnat_exporter_configs WHERE organization_id = \?/);
    expect(params).toEqual([ORGANIZATION_ID]);
  });
});

describe('release-only collector recovery', () => {
  test.each([
    [{ collector_api_token_id: 100, incident_reference: '   ' }, /incident_reference/],
    [{ collector_api_token_id: 100, incident_reference: 'INC-1', destination_ip: '1.1.1.1' },
      /Unknown body fields/],
  ])('requires a strict replacement-token and incident-reference body', async (body, message) => {
    const { connection } = configDatabase({ existing: existingConfig(), openBindings: 1 });

    await expect(approveReleaseRecovery(
      ORGANIZATION_ID, 7, body, { approvalActorId: APPROVER_ID },
    )).rejects.toThrow(message);

    expect(db.withPrimaryContext).not.toHaveBeenCalled();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('requires the replacement token to be active, same-org, exact-scope and permitted', async () => {
    const { connection } = configDatabase({
      existing: existingConfig(), openBindings: 1, tokenRows: [],
    });

    await expect(approveReleaseRecovery(ORGANIZATION_ID, 7, {
      collector_api_token_id: 100,
      incident_reference: 'INC-invalid-replacement',
    }, { approvalActorId: APPROVER_ID })).rejects.toThrow(/active same-organization exact-scope/);

    const tokenCall = db.query.mock.calls.find(([sql]) => /FROM api_tokens/.test(sql));
    expect(tokenCall[0]).toMatch(/organization_id = \?/);
    expect(tokenCall[0]).toMatch(/JSON_LENGTH\(scopes\) = 1/);
    expect(tokenCall[0]).toContain("= 'cgnat_attribution:ingest'");
    expect(tokenCall[1]).toEqual([100, ORGANIZATION_ID]);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('records an immutable incident approval and permanently faults the epoch', async () => {
    const recovered = existingConfig({
      recovery_collector_api_token_id: 100,
      recovery_reference: 'INC-2026-08-15-1',
      recovery_approved_by: APPROVER_ID,
      recovery_approved_at: new Date('2026-08-15T12:00:00.000Z'),
      incomplete_metadata_events: 1,
    });
    const { connection } = configDatabase({
      existing: existingConfig(), openBindings: 2, saved: recovered,
    });
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM api_tokens/.test(sql)) {
        return [Number(params[0]) === 100 ? [{ id: 100, user_id: 50 }] : []];
      }
      throw new Error(`Unexpected recovery primary SQL: ${sql}`);
    });

    const result = await approveReleaseRecovery(ORGANIZATION_ID, 7, {
      collector_api_token_id: 100,
      incident_reference: 'INC-2026-08-15-1',
    }, { approvalActorId: APPROVER_ID });

    expect(result).toMatchObject({
      id: 7, recovery_collector_api_token_id: 100,
      recovery_reference: 'INC-2026-08-15-1',
      recovery_approved_by: APPROVER_ID,
      incomplete_metadata_events: 1,
    });
    expect(result).not.toHaveProperty('organization_id');
    expect(db.query.mock.calls.filter(([sql]) => /FROM api_tokens/.test(sql))
      .map(([, params]) => params)).toEqual([
      [100, ORGANIZATION_ID],
      [99, ORGANIZATION_ID],
    ]);
    expect(connection.execute.mock.calls[0]).toEqual([
      'SELECT id FROM organizations WHERE id = ? FOR UPDATE', [ORGANIZATION_ID],
    ]);
    const ownerCall = connection.execute.mock.calls.find(([sql]) => (
      /collector_api_token_id = \? OR recovery_collector_api_token_id = \?/.test(sql)
    ));
    expect(ownerCall[1]).toEqual([ORGANIZATION_ID, 100, 100]);
    const recoveryWrite = connection.execute.mock.calls.find(([sql]) => (
      /SET recovery_collector_api_token_id/.test(sql)
    ));
    expect(recoveryWrite[0]).toMatch(/incomplete_metadata_events = incomplete_metadata_events \+ 1/);
    expect(recoveryWrite[1]).toEqual([100, 'INC-2026-08-15-1', APPROVER_ID,
      7, ORGANIZATION_ID]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('refuses recovery while the frozen primary collector is still valid', async () => {
    const { connection } = configDatabase({ existing: existingConfig(), openBindings: 1 });
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM api_tokens/.test(sql)) {
        return [[{ id: Number(params[0]), user_id: 50 }]];
      }
      throw new Error(`Unexpected recovery primary SQL: ${sql}`);
    });

    await expect(approveReleaseRecovery(ORGANIZATION_ID, 7, {
      collector_api_token_id: 100, incident_reference: 'INC-live-primary',
    }, { approvalActorId: APPROVER_ID })).rejects.toThrow(/frozen collector token remains valid/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('requires the frozen primary token and replacement token to differ', async () => {
    const { connection } = configDatabase({ existing: existingConfig(), openBindings: 1 });
    db.query.mockResolvedValue([[{ id: 99, user_id: 50 }]]);

    await expect(approveReleaseRecovery(ORGANIZATION_ID, 7, {
      collector_api_token_id: 99,
      incident_reference: 'INC-same-token',
    }, { approvalActorId: APPROVER_ID })).rejects.toThrow(/requires a different collector token/);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('requires at least one open binding in the exact same tenant/exporter epoch', async () => {
    const { connection } = configDatabase({ existing: existingConfig(), openBindings: 0 });
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM api_tokens/.test(sql)) {
        return [Number(params[0]) === 100 ? [{ id: 100, user_id: 50 }] : []];
      }
      throw new Error(`Unexpected recovery primary SQL: ${sql}`);
    });

    await expect(approveReleaseRecovery(ORGANIZATION_ID, 7, {
      collector_api_token_id: 100,
      incident_reference: 'INC-no-open-bindings',
    }, { approvalActorId: APPROVER_ID })).rejects.toThrow(/only available while.*open allocations/);

    const openCall = connection.execute.mock.calls.find(([sql]) => (
      /FROM cgnat_attribution_bindings/.test(sql)
    ));
    expect(openCall[0]).toMatch(/organization_id = \?/);
    expect(openCall[0]).toMatch(/exporter_config_id = \?/);
    expect(openCall[1]).toEqual([ORGANIZATION_ID, 7]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('rejects a replacement token already frozen to any exporter epoch', async () => {
    const { connection } = configDatabase({
      existing: existingConfig(), openBindings: 2, duplicateTokenOwner: true,
    });
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM api_tokens/.test(sql)) {
        return [Number(params[0]) === 100 ? [{ id: 100, user_id: 50 }] : []];
      }
      throw new Error(`Unexpected recovery primary SQL: ${sql}`);
    });

    await expect(approveReleaseRecovery(ORGANIZATION_ID, 7, {
      collector_api_token_id: 100,
      incident_reference: 'INC-token-owner',
    }, { approvalActorId: APPROVER_ID })).rejects.toThrow(/only one exporter evidence epoch/);

    expect(connection.execute.mock.calls.some(([sql]) => (
      /SET recovery_collector_api_token_id/.test(sql)
    ))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('cannot approve release recovery twice for one permanently faulted epoch', async () => {
    const { connection } = configDatabase({
      existing: existingConfig({
        recovery_collector_api_token_id: 100,
        recovery_reference: 'INC-first',
        recovery_approved_by: APPROVER_ID,
        recovery_approved_at: new Date('2026-08-15T12:00:00.000Z'),
        incomplete_metadata_events: 1,
      }),
      openBindings: 1,
    });
    db.query.mockResolvedValue([[{ id: 101, user_id: 50 }]]);

    await expect(approveReleaseRecovery(ORGANIZATION_ID, 7, {
      collector_api_token_id: 101,
      incident_reference: 'INC-second',
    }, { approvalActorId: APPROVER_ID })).rejects.toThrow(/already has an approved/);

    expect(connection.execute.mock.calls.some(([sql]) => (
      /SET recovery_collector_api_token_id/.test(sql)
    ))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});
