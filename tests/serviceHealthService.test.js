// =============================================================================
// FireISP 5.0 — serviceHealthService Tests (P1 §3.2)
// =============================================================================

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

const { getSnapshot } = require('../src/services/serviceHealthService');

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDbResult(row) {
  return [row ? [row] : [], []];
}

function makeDbResultRows(rows) {
  return [rows, []];
}

// ---------------------------------------------------------------------------
// Full snapshot
// ---------------------------------------------------------------------------

describe('serviceHealthService.getSnapshot', () => {
  it('returns a snapshot with all fields populated', async () => {
    // getSnapshot runs its five sub-queries concurrently via Promise.all, and
    // getSnmpMetrics alone now issues three SEQUENTIAL queries (see below) —
    // so the real call order interleaves across all five functions in a way
    // that is an implementation detail, not part of the contract. Route by
    // SQL content instead of call position.
    mockQuery.mockImplementation((sql) => {
      // getRadiusSession now delegates its liveness check to
      // radiusService.getActiveSession (event_type IN ('start',
      // 'interim-update'), no 'stop' since) instead of querying `radius`
      // directly — `radius` is only queried as a fallback when there is NO
      // live session, to still surface the provisioned username.
      if (/event_type IN/i.test(sql)) {
        return Promise.resolve(makeDbResult({
          username: 'client001', ip_address: '10.0.0.5', session_id: 'sess-1',
          bytes_in: 1024, bytes_out: 2048, session_duration: 3600,
          event_type: 'start', event_at: '2026-04-29T08:00:00Z',
        }));
      }
      if (/FROM radius\b/i.test(sql)) {
        return Promise.resolve(makeDbResult({ username: 'client001' }));
      }
      if (/terminate_cause/i.test(sql)) {
        return Promise.resolve(makeDbResult({
          event_type: 'start', ip_address: '10.0.0.5',
          terminate_cause: null, created_at: '2026-04-29T08:00:00Z',
        }));
      }
      // getSnmpMetrics resolves in three steps since snmp_metrics is a WIDE
      // table (no per-OID rows): 1. devices -> snmp_profile_id, 2.
      // snmp_profile_oids -> which column each OID lives in, 3. snmp_metrics
      // -> the device's latest wide row, values plucked by column.
      if (/FROM devices\b/i.test(sql) && /snmp_profile_id/i.test(sql)) {
        return Promise.resolve(makeDbResultRows([
          { device_id: 1, snmp_profile_id: 10 },
          { device_id: 2, snmp_profile_id: 20 },
        ]));
      }
      if (/FROM snmp_profile_oids/i.test(sql)) {
        return Promise.resolve(makeDbResultRows([
          { profile_id: 10, oid_name: 'ifInOctets', metric_column: 'if_in_octets' },
          { profile_id: 20, oid_name: 'ifOutOctets', metric_column: 'if_out_octets' },
        ]));
      }
      if (/FROM snmp_metrics/i.test(sql)) {
        return Promise.resolve(makeDbResultRows([
          { device_id: 1, if_in_octets: 123456, polled_at: '2026-04-29T09:50:00Z' },
          { device_id: 2, if_out_octets: 654321, polled_at: '2026-04-29T09:51:00Z' },
        ]));
      }
      if (/FROM contracts/i.test(sql)) {
        return Promise.resolve(makeDbResult({
          ip_address: '10.0.1.1', firerelay_node_id: 'node-A',
          type: 'router', download_speed_mbps: 50, upload_speed_mbps: 10,
        }));
      }
      if (/FROM speed_tests/i.test(sql)) {
        return Promise.resolve(makeDbResult({
          download_mbps: 48.5, upload_mbps: 9.8,
          latency_ms: 12, jitter_ms: 2, packet_loss_pct: 0,
          tested_at: '2026-04-29T07:00:00Z',
        }));
      }
      return Promise.resolve(makeDbResultRows([]));
    });

    const snap = await getSnapshot(100, [1, 2]);

    expect(snap.contractId).toBe(100);

    expect(snap.radiusSession).toMatchObject({
      online: true, username: 'client001', ip: '10.0.0.5', sessionTime: 3600,
    });

    expect(snap.lastConnectionLog).toMatchObject({
      event_type: 'start', ip_address: '10.0.0.5',
    });

    expect(snap.snmpMetrics).toHaveLength(2);
    expect(snap.snmpMetrics[0].oidName).toBe('ifInOctets');
    expect(snap.snmpMetrics[0].value).toBe(123456);
    expect(snap.snmpMetrics[1].value).toBe(654321);

    expect(snap.routerOsQueue).toMatchObject({
      downloadLimit: 50, uploadLimit: 10, enabled: true, source: 'plan_config',
    });

    expect(snap.lastSpeedTest).toMatchObject({
      downloadMbps: 48.5, uploadMbps: 9.8, latencyMs: 12,
    });
  });

  it('returns null fields when no data exists', async () => {
    // All queries return empty result sets
    mockQuery.mockResolvedValue([[], []]);

    const snap = await getSnapshot(999, []);

    expect(snap.contractId).toBe(999);
    expect(snap.radiusSession).toBeNull();
    expect(snap.lastConnectionLog).toBeNull();
    expect(snap.snmpMetrics).toEqual([]);
    expect(snap.routerOsQueue).toBeNull();
    expect(snap.lastSpeedTest).toBeNull();
  });

  it('skips SNMP query when pathDeviceIds is empty', async () => {
    // Content-routed rather than positional: getRadiusSession now issues up
    // to TWO sequential queries of its own (the session-liveness check, then
    // — only when that comes back empty — a fallback account lookup), so a
    // purely positional mock queue no longer lines up with a fixed count.
    mockQuery.mockImplementation(() => Promise.resolve([[], []]));

    const snap = await getSnapshot(100, []);

    expect(snap.snmpMetrics).toEqual([]);
    // RADIUS session query + RADIUS account fallback (no live session found)
    // + last connection log + routerOs + speedtest = 5. SNMP is skipped
    // entirely (pathDeviceIds is empty), never issuing its own query.
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it('tolerates individual query failures gracefully', async () => {
    // RADIUS session — database error
    mockQuery.mockRejectedValueOnce(new Error('RADIUS DB error'));
    // Last connection log — empty
    mockQuery.mockResolvedValueOnce([[], []]);
    // SNMP — empty (pathDeviceIds = [1])
    mockQuery.mockResolvedValueOnce([[], []]);
    // RouterOS — database error
    mockQuery.mockRejectedValueOnce(new Error('RouterOS DB error'));
    // Speed test — empty
    mockQuery.mockResolvedValueOnce([[], []]);

    const snap = await getSnapshot(100, [1]);

    // Should not throw — partial results returned
    expect(snap.contractId).toBe(100);
    expect(snap.radiusSession).toBeNull();
    expect(snap.routerOsQueue).toBeNull();
    expect(snap.lastSpeedTest).toBeNull();
  });

  it('marks radiusSession.online=false when there is no live session (fabricated online: true was the CRITICAL bug fixed here)', async () => {
    // online must reflect a live SESSION, never account state (a contract
    // can be perfectly provisioned/'active' on the `radius` account row and
    // still be genuinely offline). No live event_type IN ('start',
    // 'interim-update') row with no later 'stop' exists here, so
    // getRadiusSession must fall back to the (offline) provisioned account.
    mockQuery.mockImplementation((sql) => {
      if (/event_type IN/i.test(sql)) return Promise.resolve([[], []]);
      if (/FROM radius\b/i.test(sql)) return Promise.resolve(makeDbResult({ username: 'client002' }));
      return Promise.resolve([[], []]);
    });

    const snap = await getSnapshot(200, []);
    expect(snap.radiusSession).toMatchObject({ online: false, username: 'client002' });
  });
});
