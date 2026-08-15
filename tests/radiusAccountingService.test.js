// =============================================================================
// FireISP 5.0 — RADIUS accounting lifecycle/projection tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const {
  ingestAccounting,
  combineOctetsGigawords,
  calculateUsageDelta,
  exportCdr,
  listMacMoveEvents,
  deriveStackType,
  normalizeEventTimestamp,
  normalizeTerminateCause,
} = require('../src/services/radiusAccountingService');

const SESSION_UUID = '00000000-0000-4000-8000-000000000001';

function accountRow(overrides = {}) {
  return {
    radius_id: 1,
    contract_id: 5,
    client_id: 3,
    resolved_nas_id: 2,
    resolved_nas_ip: '10.0.0.1',
    ...overrides,
  };
}

function currentRow(overrides = {}) {
  return {
    id: 40,
    session_instance_id: SESSION_UUID,
    event_type: 'start',
    event_at: new Date('2026-08-14T10:00:00.000Z'),
    last_accounting_at: new Date('2026-08-14T10:00:00.000Z'),
    contract_id: 5,
    client_id: 3,
    nas_id: 2,
    username: 'alice',
    bytes_in: 100,
    bytes_out: 200,
    packets_in: 1,
    packets_out: 2,
    session_duration: 60,
    usage_accounting_complete: 1,
    attribution_evidence_complete: 1,
    attribution_anomaly_reason: null,
    usage_anomaly_count: 0,
    usage_last_bytes_in: 100,
    usage_last_bytes_out: 200,
    usage_last_packets_in: 1,
    usage_last_packets_out: 2,
    usage_last_duration: 60,
    terminate_cause: null,
    framed_ip: '192.0.2.10',
    framed_ipv6_prefix: null,
    calling_station_id: 'AA:AA:AA:AA:AA:AA',
    ...overrides,
  };
}

function makeConnection({
  primaryRows = [], legacyRows = [], openRows = [], insertId = 42,
  releaseResult = 1, failInsert = null,
} = {}) {
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  connection.execute = jest.fn(async (sql) => {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: releaseResult }]];
    if (sql.includes('FROM connection_logs')) {
      if (sql.includes('(acct_session_id IS NULL OR acct_session_id !=')) return [openRows];
      if (sql.includes('acct_session_id IS NULL AND session_id')) return [legacyRows];
      return [primaryRows];
    }
    if (sql.includes('INSERT INTO connection_logs')) {
      if (failInsert) throw failInsert;
      return [{ insertId }];
    }
    if (sql.includes('INSERT INTO radius_accounting_usage_daily')) return [{ affectedRows: 1 }];
    if (sql.includes('INSERT INTO collector_ingest_receipts')) return [{ insertId: 91 }];
    if (sql.includes('INSERT INTO mac_move_events')) return [{ insertId: 90 }];
    if (sql.includes('UPDATE connection_logs')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  db.getConnection.mockResolvedValueOnce(connection);
  return connection;
}

function attrs(overrides = {}) {
  return {
    acctStatusType: 'Start',
    userName: 'alice',
    acctSessionId: 'session-1',
    nasIpAddress: '10.0.0.1',
    organizationId: 7,
    nasId: 2,
    eventTimestamp: '2026-08-14T10:00:00.000Z',
    ...overrides,
  };
}

describe('radiusAccountingService', () => {
  const realNow = Date.now;

  beforeEach(() => {
    jest.clearAllMocks();
    Date.now = jest.fn(() => Date.parse('2026-08-14T12:00:00.000Z'));
    db.query.mockResolvedValue([[accountRow()]]);
  });

  afterAll(() => {
    Date.now = realNow;
  });

  describe('normalization helpers', () => {
    test('combines 32-bit Gigawords without exceeding safe integers', () => {
      expect(combineOctetsGigawords(500, 1)).toBe(4294967796);
      expect(combineOctetsGigawords(null, 2)).toBe(8589934592);
      expect(() => combineOctetsGigawords(Number.MAX_SAFE_INTEGER, 1)).toThrow(/safe-integer/i);
    });

    test('derives IP stack type and stable terminate-cause names', () => {
      expect(deriveStackType('192.0.2.1', '2001:db8::/64')).toBe('dual');
      expect(deriveStackType(null, '2001:db8::/64')).toBe('ipv6');
      expect(deriveStackType('192.0.2.1', null)).toBe('ipv4');
      expect(normalizeTerminateCause(1)).toBe('User-Request');
      expect(normalizeTerminateCause('18')).toBe('Host-Request');
    });

    test('accepts Unix seconds and timezone-qualified ISO timestamps only', () => {
      expect(normalizeEventTimestamp('1786701600')).toEqual(new Date(1786701600000));
      expect(normalizeEventTimestamp('2026-08-14T04:00:00-06:00')).toEqual(new Date('2026-08-14T10:00:00Z'));
      expect(() => normalizeEventTimestamp('2026-08-14 10:00:00')).toThrow(/timestamp/i);
    });
  });

  describe('usage delta safety', () => {
    test('a clean zero Start creates a complete zero baseline', () => {
      const usage = calculateUsageDelta({
        current: { bytesIn: 0, bytesOut: 0, packetsIn: 0, packetsOut: 0, duration: 0 },
        eventAt: new Date('2026-08-14T10:00:00Z'),
        initializeBaseline: true,
      });
      expect(usage).toMatchObject({
        nextSessionComplete: true,
        rowComplete: true,
        anomalyReason: null,
        deltas: { bytesIn: 0, bytesOut: 0 },
      });
    });

    test('omitted octet counters preserve the baseline and the next packet adds only its true delta', () => {
      const missing = calculateUsageDelta({
        previous: { bytesIn: 100, bytesOut: 200 },
        current: { bytesIn: null, bytesOut: null },
        previousEventAt: new Date('2026-08-14T10:00:00Z'),
        eventAt: new Date('2026-08-14T10:05:00Z'),
      });
      const next = calculateUsageDelta({
        previous: { bytesIn: 100, bytesOut: 200 },
        current: { bytesIn: 120, bytesOut: 230 },
        previousEventAt: new Date('2026-08-14T10:05:00Z'),
        eventAt: new Date('2026-08-14T10:10:00Z'),
      });
      expect(missing.deltas).toMatchObject({ bytesIn: 0, bytesOut: 0 });
      expect(missing.nextSessionComplete).toBe(true);
      expect(next.deltas).toMatchObject({ bytesIn: 20, bytesOut: 30 });
    });

    test('counter reset baselines at zero delta and fails closed', () => {
      const usage = calculateUsageDelta({
        previous: { bytesIn: 1000, bytesOut: 2000 },
        current: { bytesIn: 10, bytesOut: 20 },
        previousEventAt: new Date('2026-08-14T10:00:00Z'),
        eventAt: new Date('2026-08-14T10:05:00Z'),
      });
      expect(usage.deltas).toMatchObject({ bytesIn: 0, bytesOut: 0 });
      expect(usage).toMatchObject({ nextSessionComplete: false, rowComplete: false, anomalyReason: 'counter_reset' });
    });

    test('ordinary midnight stays complete but a month boundary fails monetary use closed', () => {
      const withinMonth = calculateUsageDelta({
        previous: { bytesIn: 100, bytesOut: 100 },
        current: { bytesIn: 120, bytesOut: 130 },
        previousEventAt: new Date('2026-08-14T23:58:00Z'),
        eventAt: new Date('2026-08-15T00:03:00Z'),
      });
      const monthBoundary = calculateUsageDelta({
        previous: { bytesIn: 120, bytesOut: 130 },
        current: { bytesIn: 140, bytesOut: 160 },
        previousEventAt: new Date('2026-08-31T23:58:00Z'),
        eventAt: new Date('2026-09-01T00:03:00Z'),
      });
      expect(withinMonth).toMatchObject({ rowComplete: true, anomalyReason: 'utc_daily_allocation_estimate' });
      expect(monthBoundary).toMatchObject({ rowComplete: false, crossesUtcMonthBoundary: true });
    });
  });

  describe('lifecycle ingestion', () => {
    test('inserts a Start atomically under the common subscriber advisory lock', async () => {
      const connection = makeConnection();
      await expect(ingestAccounting(attrs())).resolves.toMatchObject({
        action: 'insert', id: 42, macMove: false,
        sessionInstanceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
      const insert = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO connection_logs'));
      expect(insert[0]).toContain('last_accounting_received_at');
      expect(insert[0]).toContain('session_instance_id');
      expect(insert[1].slice(1, 3)).toEqual([5, 3]);
    });

    test('uses an unattributed sentinel while retaining an unknown subscriber Start', async () => {
      db.query.mockResolvedValueOnce([[accountRow({ radius_id: null, contract_id: null, client_id: null })]]);
      const connection = makeConnection({ insertId: 77 });
      await expect(ingestAccounting(attrs({ userName: 'unknown' }))).resolves.toMatchObject({ id: 77 });
      const insert = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO connection_logs'));
      expect(insert[1].slice(1, 3)).toEqual([0, 0]);
    });

    test('requires explicit NAS id and reported IP to identify the same active tenant NAS', async () => {
      db.query.mockResolvedValueOnce([[accountRow({ resolved_nas_ip: '10.0.0.2' })]]);
      await expect(ingestAccounting(attrs())).rejects.toThrow(/does not match/i);
      expect(db.getConnection).not.toHaveBeenCalled();
      expect(db.query.mock.calls[0][0]).toContain("n.status = 'active'");
      expect(db.query.mock.calls[0][0]).toContain('n.organization_id = ?');
    });

    test('canonical IPv6 spellings compare equal for tenant NAS ownership', async () => {
      db.query.mockResolvedValueOnce([[accountRow({ resolved_nas_ip: '2001:db8::1' })]]);
      makeConnection();
      await expect(ingestAccounting(attrs({
        nasIpAddress: '2001:0db8:0000:0000:0000:0000:0000:0001',
      }))).resolves.toMatchObject({ action: 'insert' });
    });

    test('rejects a session duration that would underflow the supported timestamp range', async () => {
      await expect(ingestAccounting(attrs({ acctSessionTime: 2_000_000_000 }))).rejects.toThrow(/chronology/i);
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test('derives an absent Event-Timestamp from receipt time minus Acct-Delay-Time', async () => {
      const connection = makeConnection();
      await ingestAccounting(attrs({ eventTimestamp: null, acctDelayTime: 15 }));
      const insert = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO connection_logs'));
      expect(insert[1][13]).toEqual(new Date('2026-08-14T11:59:45.000Z'));
    });

    test('updates an existing Interim and records only monotonic usage deltas', async () => {
      const connection = makeConnection({ primaryRows: [currentRow()] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Interim-Update',
        eventTimestamp: '2026-08-14T10:05:00.000Z',
        acctInputOctets: 150,
        acctOutputOctets: 260,
        acctInputPackets: 2,
        acctOutputPackets: 4,
        acctSessionTime: 120,
      }));
      expect(result).toMatchObject({ action: 'update', id: 40 });
      const usageInsert = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO radius_accounting_usage_daily'));
      expect(usageInsert[1].slice(8, 13)).toEqual([50, 60, 1, 2, 60]);
      const projectionUpdate = connection.execute.mock.calls.find(([sql]) => sql.includes('UPDATE connection_logs'));
      expect(projectionUpdate[0]).toContain('usage_last_bytes_in = COALESCE');
    });

    test('first Interim may assign the lifecycle IPv4 without replacing the session', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ framed_ip: null })] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Interim-Update',
        eventTimestamp: '2026-08-14T10:05:00.000Z',
        framedIpAddress: '198.18.0.10',
      }));
      expect(result).toMatchObject({ action: 'update', id: 40 });
      const update = connection.execute.mock.calls.find(([sql]) => sql.includes('UPDATE connection_logs'));
      expect(update[0]).toContain('framed_ip             = COALESCE(?, framed_ip)');
      expect(update[1]).toContain('198.18.0.10');
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    test('rejects IPv4 reassignment inside one lifecycle without mutating evidence projection', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ framed_ip: '8.8.8.8' })] });
      await expect(ingestAccounting(attrs({
        acctStatusType: 'Interim-Update',
        eventTimestamp: '2026-08-14T10:05:00.000Z',
        framedIpAddress: '1.1.1.1',
      }))).rejects.toThrow(/Framed-IP-Address changed within one access-session lifecycle/);
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('UPDATE connection_logs'))).toBe(false);
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('radius_accounting_usage_daily'))).toBe(false);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    test('rejects IPv6-prefix reassignment inside one lifecycle without mutation', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({
        framed_ip: null, framed_ipv6_prefix: '2001:db8:1::/56',
      })] });
      await expect(ingestAccounting(attrs({
        acctStatusType: 'Interim-Update',
        eventTimestamp: '2026-08-14T10:05:00.000Z',
        framedIpv6Prefix: '2001:db8:2::/56',
      }))).rejects.toThrow(/Framed-IPv6-Prefix changed within one access-session lifecycle/);
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('UPDATE connection_logs'))).toBe(false);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    test('a new Start lifecycle may receive a different dynamic public IPv4', async () => {
      const connection = makeConnection();
      const result = await ingestAccounting(attrs({
        acctSessionId: 'session-2', framedIpAddress: '1.1.1.1',
        eventTimestamp: '2026-08-14T11:00:00.000Z',
      }));
      expect(result).toMatchObject({ action: 'insert', id: 42 });
      const insert = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO connection_logs'));
      expect(insert[1]).toContain('1.1.1.1');
    });

    test('same NAS/session id with a conflicting public IP closes the old lifecycle and creates a new UUID', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ framed_ip: '8.8.8.8' })] });
      const result = await ingestAccounting(attrs({
        framedIpAddress: '1.1.1.1',
        eventTimestamp: '2026-08-14T10:00:01.000Z',
      }));

      expect(result).toMatchObject({ action: 'insert', id: 42 });
      const close = connection.execute.mock.calls.find(([sql]) => (
        sql.includes('terminate_cause = ?') && sql.includes("event_type = 'stop'")
      ));
      expect(close[1]).toEqual(['Session-Identity-Changed',
        new Date('2026-08-14T10:00:01.000Z'), 40, 7]);
      const insert = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO connection_logs'));
      expect(insert[1]).toContain('1.1.1.1');
      expect(insert[1]).not.toContain(SESSION_UUID);
    });

    test('same NAS/session id with a conflicting non-null MAC creates a new lifecycle', async () => {
      const connection = makeConnection({ primaryRows: [currentRow()] });
      const result = await ingestAccounting(attrs({
        callingStationId: 'BB:BB:BB:BB:BB:BB',
        eventTimestamp: '2026-08-14T10:00:01.000Z',
      }));
      expect(result).toMatchObject({ action: 'insert', macMove: true });
      expect(connection.execute.mock.calls.some(([sql]) => (
        sql.includes('Session-Identity-Changed')
      ))).toBe(false);
      const close = connection.execute.mock.calls.find(([sql]) => sql.includes('terminate_cause = ?'));
      expect(close[1][0]).toBe('Session-Identity-Changed');
    });

    test('a packet omitting octets does not erase the raw usage baseline', async () => {
      const connection = makeConnection({ primaryRows: [currentRow()] });
      await ingestAccounting(attrs({
        acctStatusType: 'Interim-Update',
        eventTimestamp: '2026-08-14T10:05:00.000Z',
        acctInputOctets: null,
        acctOutputOctets: null,
      }));
      const update = connection.execute.mock.calls.find(([sql]) => sql.includes('UPDATE connection_logs'));
      expect(update[0]).toContain('CASE WHEN ? IS NULL THEN bytes_in');
      expect(update[0]).toContain('usage_last_bytes_out = COALESCE');
      expect(update[1][2]).toBeNull();
      expect(update[1][4]).toBeNull();
    });

    test('an exact Interim replay is a no-op and creates no usage delta', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ event_type: 'interim-update' })] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Interim-Update',
        acctInputOctets: 100,
        acctOutputOctets: 200,
        acctInputPackets: 1,
        acctOutputPackets: 2,
        acctSessionTime: 60,
      }));
      expect(result.action).toBe('noop');
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('UPDATE connection_logs'))).toBe(false);
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('radius_accounting_usage_daily'))).toBe(false);
    });

    test('an out-of-order Stop closes and permanently faults attribution instead of disappearing', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({
        event_type: 'interim-update',
        last_accounting_at: new Date('2026-08-14T10:10:00.000Z'),
      })] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Stop', eventTimestamp: '2026-08-14T10:09:00.000Z',
      }));
      expect(result).toMatchObject({ action: 'update', id: 40,
        attributionEvidenceComplete: false });
      const update = connection.execute.mock.calls.find(([sql]) => (
        sql.includes("attribution_anomaly_reason = 'out_of_order_stop'")
      ));
      expect(update[0]).toContain('attribution_evidence_complete = 0');
      expect(update[1][1]).toEqual(new Date('2026-08-14T10:09:00.000Z'));
    });

    test('a corrected Stop at the same timestamp merges only improved final counters', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ event_type: 'stop' })] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Stop',
        acctInputOctets: 125,
        acctOutputOctets: 240,
        acctSessionTime: 60,
      }));
      expect(result.action).toBe('update');
      const usageInsert = connection.execute.mock.calls.find(([sql]) => sql.includes('radius_accounting_usage_daily'));
      expect(usageInsert[1].slice(8, 10)).toEqual([25, 40]);
    });

    test('a delayed counter correction without Event-Timestamp preserves the original Stop time', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ event_type: 'stop' })] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Stop', eventTimestamp: null,
        acctInputOctets: 125, acctOutputOctets: 240,
      }));
      expect(result.action).toBe('update');
      const update = connection.execute.mock.calls.find(([sql]) => (
        sql.includes('WHERE id = ?') && sql.includes("event_type = 'stop'")
      ));
      expect(update[1]).toContainEqual(new Date('2026-08-14T10:00:00.000Z'));
      expect(update[1]).not.toContainEqual(new Date('2026-08-14T12:00:00.000Z'));
    });

    test('an identical delayed Stop without Event-Timestamp is a replay, not a new lifecycle', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ event_type: 'stop' })] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Stop',
        eventTimestamp: null,
        acctInputOctets: 100,
        acctOutputOctets: 200,
        acctInputPackets: 1,
        acctOutputPackets: 2,
        acctSessionTime: 60,
        framedIpAddress: '192.0.2.10',
      }));

      expect(result).toMatchObject({ action: 'noop', id: 40 });
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO connection_logs'))).toBe(false);
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('UPDATE connection_logs'))).toBe(false);
    });

    test('an ambiguous delayed Stop with omitted counters fails conservative as a replay', async () => {
      const connection = makeConnection({ primaryRows: [currentRow({ event_type: 'stop' })] });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Stop',
        eventTimestamp: null,
        acctInputOctets: null,
        acctOutputOctets: null,
        acctInputPackets: null,
        acctOutputPackets: null,
        acctSessionTime: 60,
        framedIpAddress: '192.0.2.10',
      }));

      expect(result).toMatchObject({ action: 'noop', id: 40 });
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO connection_logs'))).toBe(false);
    });

    test('a stopped session id reused immediately by a later Start creates a new lifecycle', async () => {
      const stopped = currentRow({ event_type: 'stop', last_accounting_at: new Date('2026-08-14T10:00:00Z') });
      const connection = makeConnection({ primaryRows: [stopped] });
      const result = await ingestAccounting(attrs({ eventTimestamp: '2026-08-14T10:00:01.000Z' }));
      expect(result.action).toBe('insert');
      expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO connection_logs'))).toBe(true);
    });

    test('a later missed-Start Stop with the same NAS session id is a separate incomplete lifecycle', async () => {
      const stopped = currentRow({ event_type: 'stop', last_accounting_at: new Date('2026-08-14T10:00:00Z') });
      const connection = makeConnection({ primaryRows: [stopped], insertId: 88 });
      const result = await ingestAccounting(attrs({
        acctStatusType: 'Stop',
        eventTimestamp: '2026-08-14T10:10:00.000Z',
        acctSessionTime: 600,
        acctInputOctets: 1000,
        acctOutputOctets: 2000,
      }));
      expect(result).toMatchObject({ action: 'insert', id: 88 });
      const usageInsert = connection.execute.mock.calls.find(([sql]) => sql.includes('radius_accounting_usage_daily'));
      expect(usageInsert[1].slice(8, 13)).toEqual([0, 0, 0, 0, 0]);
      expect(usageInsert[1][13]).toBe(0);
      expect(usageInsert[1][15]).toBe('missing_start_baseline');
    });

    test('MAC-move closure ends at the accepted Start event time and records receipt chronology', async () => {
      const connection = makeConnection({ openRows: [{
        id: 11,
        calling_station_id: 'AA:AA:AA:AA:AA:AA',
        nas_id: 8,
        acct_session_id: 'old',
        event_at: new Date('2026-08-14T09:00:00Z'),
      }] });
      const result = await ingestAccounting(attrs({
        callingStationId: 'BB:BB:BB:BB:BB:BB',
        eventTimestamp: '2026-08-14T09:59:30.000Z',
      }));
      expect(result.macMove).toBe(true);
      const moveUpdate = connection.execute.mock.calls.find(([sql]) => sql.includes("terminate_cause = 'Session-Moved'"));
      expect(moveUpdate[0]).toContain('last_accounting_at = ?');
      expect(moveUpdate[0]).toContain('last_accounting_received_at = NOW(3)');
      expect(moveUpdate[1]).toEqual([new Date('2026-08-14T09:59:30.000Z'), 11, 7]);
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    test('a persistence failure rolls back and is never reported as accepted', async () => {
      const connection = makeConnection({ failInsert: new Error('disk full') });
      await expect(ingestAccounting(attrs())).rejects.toThrow('disk full');
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.commit).not.toHaveBeenCalled();
    });

    test('uncertain advisory-lock release destroys the pooled connection', async () => {
      const connection = makeConnection({ releaseResult: 0 });
      await expect(ingestAccounting(attrs())).resolves.toMatchObject({ action: 'insert' });
      expect(connection.release).not.toHaveBeenCalled();
      expect(connection.destroy).toHaveBeenCalledTimes(1);
    });

    test('Start and Interim use the same per-tenant subscriber lock domain', async () => {
      const startConnection = makeConnection();
      await ingestAccounting(attrs());
      const interimConnection = makeConnection({ primaryRows: [currentRow()] });
      await ingestAccounting(attrs({ acctStatusType: 'Interim-Update', eventTimestamp: '2026-08-14T10:05:00Z' }));
      const startLock = startConnection.execute.mock.calls.find(([sql]) => sql.includes('GET_LOCK'))[1][0];
      const interimLock = interimConnection.execute.mock.calls.find(([sql]) => sql.includes('GET_LOCK'))[1][0];
      expect(interimLock).toBe(startLock);
    });
  });

  describe('CDR and MAC-move exports', () => {
    test('exports app sessions and legacy events without collapsing reused session identifiers', async () => {
      const rows = [
        { record_kind: 'session', session_id: 'reuse', username: 'alice' },
        { record_kind: 'legacy_event', session_id: 'reuse', username: 'alice' },
      ];
      db.query.mockResolvedValueOnce([[{ total: 2 }]]).mockResolvedValueOnce([rows]);
      const result = await exportCdr({ from: '2026-01-01', to: '2026-01-31', organizationId: 7 });
      expect(result.rows).toEqual(rows);
      expect(db.query.mock.calls[1][0]).not.toContain('GROUP BY');
      expect(db.query.mock.calls[1][0]).toContain('LIMIT 50001');
    });

    test('CSV includes record kind and formula-hardens whitespace-prefixed subscriber fields', async () => {
      db.query
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([[
          { record_kind: 'session', username: '\t=cmd', session_id: 'one' },
          { record_kind: 'session', username: '\r=1+1', session_id: 'two' },
        ]]);
      const result = await exportCdr({
        from: '2026-01-01', to: '2026-01-31', organizationId: 7, format: 'csv',
      });
      expect(result.csv).toContain('record_kind');
      expect(result.csv).toContain("'\t=cmd");
      expect(result.csv).toContain("'\r=1+1");
    });

    test('rejects invalid or over-wide export windows and explicit overflow', async () => {
      await expect(exportCdr({ from: 'bad', to: '2026-01-01', organizationId: 7 })).rejects.toThrow(/YYYY-MM-DD/);
      await expect(exportCdr({ from: '2025-01-01', to: '2026-02-01', organizationId: 7 })).rejects.toThrow(/366-day/);
      db.query.mockResolvedValueOnce([[{ total: 50001 }]]);
      await expect(exportCdr({ from: '2026-01-01', to: '2026-01-31', organizationId: 7 })).rejects.toMatchObject({
        exportMax: 50000,
      });
    });

    test('lists tenant-scoped MAC moves with validated literal pagination', async () => {
      const rows = [{ id: 1, organization_id: 7 }];
      db.query.mockResolvedValueOnce([[{ total: 1 }]]).mockResolvedValueOnce([rows]);
      const result = await listMacMoveEvents(7, { page: 2, limit: 10 });
      expect(result).toMatchObject({ rows, total: 1, page: 2, limit: 10 });
      expect(db.query.mock.calls[1][0]).toContain('LIMIT 10 OFFSET 10');
      expect(db.query.mock.calls[1][1]).toEqual([7]);
    });
  });
});
