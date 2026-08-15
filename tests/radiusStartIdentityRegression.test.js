'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const { ingestAccounting } = require('../src/services/radiusAccountingService');

const OLD_SESSION_UUID = '00000000-0000-4000-8000-000000000001';
const START_AT = '2026-08-14T10:06:00.000Z';

function duplicateSession(overrides = {}) {
  return {
    id: 40,
    session_instance_id: OLD_SESSION_UUID,
    event_type: 'start',
    event_at: new Date('2026-08-14T10:00:00.000Z'),
    last_accounting_at: new Date('2026-08-14T10:05:00.000Z'),
    framed_ip: '8.8.8.8',
    framed_ipv6_prefix: null,
    calling_station_id: 'AA:AA:AA:AA:AA:AA',
    ...overrides,
  };
}

function attrs(overrides = {}) {
  return {
    acctStatusType: 'Start',
    userName: 'alice',
    acctSessionId: 'session-1',
    nasIpAddress: '10.0.0.1',
    organizationId: 7,
    nasId: 2,
    eventTimestamp: START_AT,
    framedIpAddress: '8.8.8.8',
    callingStationId: 'AA:AA:AA:AA:AA:AA',
    ...overrides,
  };
}

function identityDatabase(duplicate) {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    destroy: jest.fn(),
    execute: jest.fn(async (sql) => {
      if (/GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/RELEASE_LOCK/.test(sql)) return [[{ released: 1 }]];
      if (/FROM connection_logs/.test(sql)) {
        if (/acct_session_id IS NULL AND session_id/.test(sql)) return [[]];
        if (/acct_session_id IS NULL OR acct_session_id !=/.test(sql)) return [[]];
        return [[duplicate]];
      }
      if (/UPDATE connection_logs/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO connection_logs/.test(sql)) return [{ insertId: 42 }];
      if (/INSERT INTO radius_accounting_usage_daily/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO collector_ingest_receipts/.test(sql)) return [{ insertId: 91 }];
      if (/INSERT INTO mac_move_events/.test(sql)) return [{ insertId: 90 }];
      throw new Error(`Unexpected RADIUS identity SQL: ${sql}`);
    }),
  };
  db.getConnection.mockResolvedValue(connection);
  return connection;
}

describe('Accounting-Start lifecycle identity', () => {
  const realNow = Date.now;

  beforeEach(() => {
    jest.clearAllMocks();
    Date.now = jest.fn(() => Date.parse('2026-08-14T12:00:00.000Z'));
    db.query.mockResolvedValue([[
      {
        radius_id: 1,
        contract_id: 5,
        client_id: 3,
        resolved_nas_id: 2,
        resolved_nas_ip: '10.0.0.1',
      },
    ]]);
  });

  afterAll(() => {
    Date.now = realNow;
  });

  test.each([
    ['public IPv4', attrs({ framedIpAddress: '1.1.1.1' }), false],
    ['calling-station MAC', attrs({ callingStationId: 'BB:BB:BB:BB:BB:BB' }), true],
  ])('does not noop or merge a live reused session ID when %s changes', async (
    _identity, incoming, expectedMacMove,
  ) => {
    const connection = identityDatabase(duplicateSession());

    const result = await ingestAccounting(incoming);

    expect(result).toMatchObject({ action: 'insert', id: 42, macMove: expectedMacMove });
    expect(result.sessionInstanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.sessionInstanceId).not.toBe(OLD_SESSION_UUID);

    const duplicateRead = connection.execute.mock.calls.find(([sql]) => (
      /acct_session_id = \?/.test(sql) && /FOR UPDATE/.test(sql)
    ));
    expect(duplicateRead[0]).toMatch(/framed_ip, framed_ipv6_prefix, calling_station_id/);
    expect(duplicateRead[1]).toEqual([7, 2, 'alice', 'session-1']);

    const closure = connection.execute.mock.calls.find(([sql]) => (
      /UPDATE connection_logs/.test(sql)
    ));
    expect(closure[1]).toEqual([
      'Session-Identity-Changed', new Date(START_AT), 40, 7,
    ]);

    const insert = connection.execute.mock.calls.find(([sql]) => (
      /INSERT INTO connection_logs/.test(sql)
    ));
    expect(insert[1][7]).toBe(result.sessionInstanceId);
    expect(insert[1][10]).toBe(incoming.callingStationId);
    expect(insert[1][11]).toBe(incoming.framedIpAddress);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  test('enriches a replayed Start with first-known IP/prefix/station on the same UUID', async () => {
    const connection = identityDatabase(duplicateSession({
      last_accounting_at: new Date('2026-08-14T10:00:00.000Z'),
      framed_ip: null,
      framed_ipv6_prefix: null,
      calling_station_id: null,
    }));
    const incoming = attrs({
      eventTimestamp: '2026-08-14T10:00:00.000Z',
      framedIpAddress: '1.1.1.1',
      framedIpv6Prefix: '2001:db8:1::/56',
      callingStationId: 'AA:AA:AA:AA:AA:AA',
    });

    const result = await ingestAccounting(incoming);

    expect(result).toMatchObject({
      action: 'update',
      id: 40,
      macMove: false,
      sessionInstanceId: OLD_SESSION_UUID,
    });
    const enrichment = connection.execute.mock.calls.find(([sql]) => (
      /UPDATE connection_logs/.test(sql)
        && /framed_ip/.test(sql)
        && /framed_ipv6_prefix/.test(sql)
        && /calling_station_id/.test(sql)
    ));
    expect(enrichment).toBeDefined();
    expect(enrichment[0]).toMatch(/organization_id = \?/);
    expect(enrichment[1]).toEqual(expect.arrayContaining([
      '1.1.1.1', '2001:db8:1::/56', 'AA:AA:AA:AA:AA:AA', 40, 7,
    ]));
    expect(connection.execute.mock.calls.some(([sql]) => (
      /INSERT INTO connection_logs/.test(sql)
    ))).toBe(false);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
});
