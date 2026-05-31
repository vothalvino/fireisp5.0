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
    // RADIUS session query
    mockQuery.mockResolvedValueOnce(makeDbResult({
      username: 'client001', status: 'active',
      ip_address: '10.0.0.5', session_id: 'sess-1',
      bytes_in: 1024, bytes_out: 2048, session_time: 3600,
    }));

    // Last connection log query
    mockQuery.mockResolvedValueOnce(makeDbResult({
      event_type: 'start', ip_address: '10.0.0.5',
      terminate_cause: null, created_at: '2026-04-29T08:00:00Z',
    }));

    // SNMP metrics query (pathDeviceIds = [1, 2])
    mockQuery.mockResolvedValueOnce(makeDbResultRows([
      { device_id: 1, oid_name: 'ifInOctets', value_gauge: 123456, value_counter: null, value_string: null, polled_at: '2026-04-29T09:50:00Z' },
      { device_id: 2, oid_name: 'ifOutOctets', value_gauge: null, value_counter: 654321, value_string: null, polled_at: '2026-04-29T09:51:00Z' },
    ]));

    // RouterOS queue query
    mockQuery.mockResolvedValueOnce(makeDbResult({
      ip_address: '10.0.1.1', firerelay_node_id: 'node-A',
      type: 'router', download_speed_mbps: 50, upload_speed_mbps: 10,
    }));

    // Speed test query
    mockQuery.mockResolvedValueOnce(makeDbResult({
      download_mbps: 48.5, upload_mbps: 9.8,
      latency_ms: 12, jitter_ms: 2, packet_loss_pct: 0,
      tested_at: '2026-04-29T07:00:00Z',
    }));

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
    // RADIUS session — empty
    mockQuery.mockResolvedValueOnce([[], []]);
    // Last connection log — empty
    mockQuery.mockResolvedValueOnce([[], []]);
    // RouterOS — empty
    mockQuery.mockResolvedValueOnce([[], []]);
    // Speed test — empty
    mockQuery.mockResolvedValueOnce([[], []]);

    const snap = await getSnapshot(100, []);

    expect(snap.snmpMetrics).toEqual([]);
    // SNMP query with empty array should not have been called
    // (total query calls = 4: radius, conn_log, routeros, speedtest)
    expect(mockQuery).toHaveBeenCalledTimes(4);
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

  it('marks radiusSession.online=false when status is not active', async () => {
    mockQuery.mockResolvedValueOnce(makeDbResult({
      username: 'client002', status: 'disabled',
      ip_address: null, session_id: null,
      bytes_in: 0, bytes_out: 0, session_time: 0,
    }));
    // Remaining queries empty
    mockQuery.mockResolvedValue([[], []]);

    const snap = await getSnapshot(200, []);
    expect(snap.radiusSession.online).toBe(false);
  });
});
