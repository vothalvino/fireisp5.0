// =============================================================================
// FireISP 5.0 — RADIUS Accounting Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const {
  ingestAccounting,
  combineOctetsGigawords,
  exportCdr,
  listMacMoveEvents,
  deriveStackType,
} = require('../src/services/radiusAccountingService');

describe('radiusAccountingService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // combineOctetsGigawords
  // ---------------------------------------------------------------------------
  describe('combineOctetsGigawords()', () => {
    test('returns 0 when both octets and gigawords are 0', () => {
      expect(combineOctetsGigawords(0, 0)).toBe(0);
    });

    test('returns octets value when gigawords is 0', () => {
      expect(combineOctetsGigawords(1000000000, 0)).toBe(1000000000);
    });

    test('adds one full gigaword wraparound (2^32) correctly', () => {
      // 500 + 1 * 4294967296 = 4294967796
      expect(combineOctetsGigawords(500, 1)).toBe(4294967796);
    });

    test('returns 0 when both inputs are null', () => {
      expect(combineOctetsGigawords(null, null)).toBe(0);
    });

    test('handles two gigawords wraparounds correctly', () => {
      // 100 + 2 * 4294967296 = 8589934692
      expect(combineOctetsGigawords(100, 2)).toBe(8589934692);
    });

    test('treats null octets as 0', () => {
      expect(combineOctetsGigawords(null, 1)).toBe(4294967296);
    });

    test('treats null gigawords as 0', () => {
      expect(combineOctetsGigawords(999, null)).toBe(999);
    });
  });

  // ---------------------------------------------------------------------------
  // deriveStackType
  // ---------------------------------------------------------------------------
  describe('deriveStackType()', () => {
    test('returns dual when both IPv4 and IPv6 addresses present', () => {
      expect(deriveStackType('10.0.0.1', '2001:db8::/48')).toBe('dual');
    });

    test('returns ipv4 when only framed IP present', () => {
      expect(deriveStackType('10.0.0.1', null)).toBe('ipv4');
    });

    test('returns ipv6 when only framed IPv6 present', () => {
      expect(deriveStackType(null, '2001:db8::/48')).toBe('ipv6');
    });

    test('returns null when neither address present', () => {
      expect(deriveStackType(null, null)).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // ingestAccounting — Start event
  // ---------------------------------------------------------------------------
  describe('ingestAccounting() — Start event', () => {
    test('inserts a new session row and returns action=insert', async () => {
      db.query
        // 1. RADIUS account lookup
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        // 2. Open session check (no existing session)
        .mockResolvedValueOnce([[]])
        // 3. INSERT into connection_logs
        .mockResolvedValueOnce([{ insertId: 42 }]);

      const result = await ingestAccounting({
        acctStatusType: 'Start',
        userName: 'alice',
        acctSessionId: 'sess001',
        nasIpAddress: '10.0.0.1',
        organizationId: 1,
      });

      expect(result.action).toBe('insert');
      expect(result.id).toBe(42);
      expect(result.macMove).toBe(false);
    });

    test('calls db.query three times (lookup, open-session check, insert)', async () => {
      db.query
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 10 }]);

      await ingestAccounting({
        acctStatusType: 'Start',
        userName: 'alice',
        acctSessionId: 'sess001',
        nasIpAddress: '10.0.0.1',
        organizationId: 1,
      });

      expect(db.query).toHaveBeenCalledTimes(3);
    });

    test('uses sentinel contractId=0 and clientId=0 when RADIUS account is not found', async () => {
      db.query
        .mockResolvedValueOnce([[]])  // no RADIUS row
        .mockResolvedValueOnce([[]])  // no open session
        .mockResolvedValueOnce([{ insertId: 77 }]);

      const result = await ingestAccounting({
        acctStatusType: 'Start',
        userName: 'unknown-user',
        acctSessionId: 'sess-x',
        nasIpAddress: '10.0.0.2',
        organizationId: 1,
      });

      expect(result.action).toBe('insert');
      // The INSERT call should have been called with contractId=0, clientId=0
      const insertCall = db.query.mock.calls[2];
      expect(insertCall[1][1]).toBe(0);  // contractId at index 1 of params
      expect(insertCall[1][2]).toBe(0);  // clientId at index 2 of params
    });

    test('includes acctInputOctetsV6, acctOutputOctetsV6, and stack_type=ipv6 in INSERT when IPv6-only', async () => {
      db.query
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 55 }]);

      await ingestAccounting({
        acctStatusType: 'Start',
        userName: 'alice',
        acctSessionId: 'sess-v6',
        nasIpAddress: '10.0.0.1',
        framedIpv6Prefix: '2001:db8::/48',
        acctInputOctetsV6: 1000,
        acctOutputOctetsV6: 2000,
        organizationId: 1,
      });

      const insertCall = db.query.mock.calls[2];
      const insertSql = insertCall[0];
      const insertParams = insertCall[1];
      expect(insertSql).toMatch(/acct_input_octets_v6/);
      expect(insertSql).toMatch(/stack_type/);
      // Find stack_type param — it's after the V6 octet params
      // The INSERT has columns: username, contractId, clientId, nasId, nasIpAddress,
      //   acctSessionId, sessionId, nasPortId, calledStationId, callingStationId,
      //   framedIp, framedIpv6Prefix, (event_type literal), (NOW() literal),
      //   bytesIn, bytesOut, acctSessionTime, acctTerminateCause,
      //   acctInputOctetsV6, acctOutputOctetsV6, stackType
      // So stackType is the last param
      const stackTypeParam = insertParams[insertParams.length - 1];
      expect(stackTypeParam).toBe('ipv6');
    });
  });

  // ---------------------------------------------------------------------------
  // ingestAccounting — Stop event
  // ---------------------------------------------------------------------------
  describe('ingestAccounting() — Stop event', () => {
    test('updates existing session row and returns action=update', async () => {
      db.query
        // 1. RADIUS account lookup
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        // 2. UPDATE existing row
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await ingestAccounting({
        acctStatusType: 'Stop',
        userName: 'alice',
        acctSessionId: 'sess001',
        nasIpAddress: '10.0.0.1',
        acctInputOctets: 1000,
        acctOutputOctets: 2000,
        acctSessionTime: 3600,
        organizationId: 1,
      });

      expect(result.action).toBe('update');
      expect(result.macMove).toBe(false);
    });

    test('returns action=insert when no existing session found (late accounting)', async () => {
      db.query
        // 1. RADIUS account lookup
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        // 2. UPDATE finds no row
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        // 3. Late INSERT
        .mockResolvedValueOnce([{ insertId: 99 }]);

      const result = await ingestAccounting({
        acctStatusType: 'Stop',
        userName: 'alice',
        acctSessionId: 'sess001',
        nasIpAddress: '10.0.0.1',
        acctInputOctets: 500,
        acctOutputOctets: 800,
        acctSessionTime: 1800,
        organizationId: 1,
      });

      expect(result.action).toBe('insert');
      expect(result.id).toBe(99);
    });
  });

  // ---------------------------------------------------------------------------
  // ingestAccounting — Interim-Update event
  // ---------------------------------------------------------------------------
  describe('ingestAccounting() — Interim-Update event', () => {
    test('updates existing session row and returns action=update', async () => {
      db.query
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await ingestAccounting({
        acctStatusType: 'Interim-Update',
        userName: 'alice',
        acctSessionId: 'sess001',
        nasIpAddress: '10.0.0.1',
        acctInputOctets: 2048,
        acctOutputOctets: 4096,
        acctSessionTime: 900,
        organizationId: 1,
      });

      expect(result.action).toBe('update');
      expect(result.macMove).toBe(false);
    });

    test('passes event_type "interim-update" to the UPDATE query', async () => {
      db.query
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await ingestAccounting({
        acctStatusType: 'Interim-Update',
        userName: 'alice',
        acctSessionId: 'sess001',
        nasIpAddress: '10.0.0.1',
        organizationId: 1,
      });

      // The UPDATE call is the second query; first param array starts with eventType
      const updateParams = db.query.mock.calls[1][1];
      expect(updateParams[0]).toBe('interim-update');
    });
  });

  // ---------------------------------------------------------------------------
  // ingestAccounting — MAC move detection
  // ---------------------------------------------------------------------------
  describe('ingestAccounting() — MAC move detection', () => {
    test('detects MAC move, synthesises stop, records mac_move_events, and inserts new start', async () => {
      db.query
        // 1. RADIUS account lookup
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        // 2. Open session check — existing session with different MAC
        .mockResolvedValueOnce([[{
          id: 10,
          calling_station_id: 'AA:BB:CC:DD:EE:FF',
          nas_id: 1,
          acct_session_id: 'old-sess',
          event_at: new Date(),
        }]])
        // 3. Synthesise stop (INSERT ... SELECT)
        .mockResolvedValueOnce([{ insertId: 11 }])
        // 4. INSERT into mac_move_events
        .mockResolvedValueOnce([{ insertId: 12 }])
        // 5. New Start INSERT
        .mockResolvedValueOnce([{ insertId: 13 }]);

      const result = await ingestAccounting({
        acctStatusType: 'Start',
        userName: 'bob',
        acctSessionId: 'new-sess',
        callingStationId: '11:22:33:44:55:66',
        nasIpAddress: '10.0.0.1',
        organizationId: 1,
      });

      expect(result.macMove).toBe(true);
      expect(result.action).toBe('insert');
      expect(result.id).toBe(13);
      // 5 total queries: lookup + open-check + synth-stop + mac_move INSERT + new start INSERT
      expect(db.query).toHaveBeenCalledTimes(5);
    });

    test('does NOT detect a MAC move when calling_station_id is unchanged', async () => {
      db.query
        .mockResolvedValueOnce([[{ radius_id: 1, contract_id: 5, client_id: 3, resolved_nas_id: 2 }]])
        // Same MAC, same NAS
        .mockResolvedValueOnce([[{
          id: 10,
          calling_station_id: 'AA:BB:CC:DD:EE:FF',
          nas_id: 2,
          acct_session_id: 'old-sess',
          event_at: new Date(),
        }]])
        .mockResolvedValueOnce([{ insertId: 20 }]);

      const result = await ingestAccounting({
        acctStatusType: 'Start',
        userName: 'bob',
        acctSessionId: 'new-sess',
        callingStationId: 'AA:BB:CC:DD:EE:FF',  // same MAC
        nasIpAddress: '10.0.0.1',
        organizationId: 1,
      });

      expect(result.macMove).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // exportCdr
  // ---------------------------------------------------------------------------
  describe('exportCdr()', () => {
    test('returns json format with rows from db', async () => {
      const fakeRows = [
        { session_id: 'sess1', username: 'alice', event_type: 'stop', bytes_in: 100, bytes_out: 200 },
      ];
      db.query.mockResolvedValueOnce([fakeRows]);

      const result = await exportCdr({
        from: '2026-01-01',
        to: '2026-01-31',
        organizationId: 1,
      });

      expect(result.format).toBe('json');
      expect(result.rows).toEqual(fakeRows);
    });

    test('returns csv format with header and data rows', async () => {
      const fakeRows = [
        {
          session_id: 'sess1', acct_session_id: 'acct1', username: 'alice',
          event_type: 'stop', event_at: '2026-01-15T10:00:00Z',
          session_duration: 3600, bytes_in: 1024, bytes_out: 2048,
          nas_ip_address: '10.0.0.1', nas_port_id: null, called_station_id: null,
          calling_station_id: null, framed_ip: null, framed_ipv6_prefix: null,
          terminate_cause: 'User-Request',
        },
      ];
      db.query.mockResolvedValueOnce([fakeRows]);

      const result = await exportCdr({
        from: '2026-01-01',
        to: '2026-01-31',
        format: 'csv',
        organizationId: 1,
      });

      expect(result.format).toBe('csv');
      expect(typeof result.csv).toBe('string');
      expect(result.csv).toContain('session_id');  // header present
      expect(result.csv).toContain('alice');
    });

    test('filters by username when provided', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await exportCdr({
        from: '2026-01-01',
        to: '2026-01-31',
        username: 'alice',
        organizationId: 1,
      });

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('cl.username = ?');
      expect(params).toContain('alice');
    });
  });

  // ---------------------------------------------------------------------------
  // listMacMoveEvents
  // ---------------------------------------------------------------------------
  describe('listMacMoveEvents()', () => {
    test('returns paginated results with total count', async () => {
      const fakeRows = [
        { id: 1, organization_id: 1, username: 'bob', old_mac: 'AA:BB:CC:DD:EE:FF', new_mac: '11:22:33:44:55:66', old_nas_id: 1, new_nas_id: 2, detected_at: new Date() },
      ];
      db.query
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([fakeRows]);

      const result = await listMacMoveEvents(1);

      expect(result.total).toBe(1);
      expect(result.rows).toEqual(fakeRows);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(25);
    });

    test('applies pagination offset correctly for page 2', async () => {
      db.query
        .mockResolvedValueOnce([[{ total: 30 }]])
        .mockResolvedValueOnce([[]]);

      await listMacMoveEvents(1, { page: 2, limit: 10 });

      const [sql, params] = db.query.mock.calls[1];
      // LIMIT/OFFSET are now interpolated as validated integer literals
      // (MySQL8 pool.execute() rejects bound '?' placeholders for LIMIT/OFFSET).
      expect(sql).toContain('LIMIT 10 OFFSET 10');   // limit=10, offset=(2-1)*10
      expect(sql).not.toContain('LIMIT ? OFFSET ?');
      // params now carries only the organizationId — no limit/offset placeholders.
      expect(params).toEqual([1]);
      expect(params).toHaveLength(1);
    });
  });
});
