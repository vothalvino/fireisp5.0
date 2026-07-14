// =============================================================================
// FireISP 5.0 — wirelessService.recordClientSessions tests
// =============================================================================
// Regression coverage for the bulk-insert-under-execute() bug: db.query()
// runs mysql2 prepared statements (pool.execute()), which cannot expand a
// single `?` bound to a 2-D array of rows the way pool.query() can. Every
// call to POST /wireless/clients/batch threw at runtime until
// recordClientSessions() was switched to sqlBuild's buildBulkValues() helper
// (explicit per-row placeholder groups + a flat, positional param array).
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  child: jest.fn().mockReturnThis(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const db = require('../src/config/database');
const { recordClientSessions } = require('../src/services/wirelessService');

describe('wirelessService.recordClientSessions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns 0 and never queries the DB for empty/absent sessions', async () => {
    expect(await recordClientSessions(1, [])).toBe(0);
    expect(await recordClientSessions(1, null)).toBe(0);
    expect(await recordClientSessions(1, undefined)).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('builds an explicit per-row VALUES clause and a flat, positional param array', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 2 }]);

    const sessions = [
      { device_id: 10, mac_address: 'aa:bb:cc:dd:ee:01', signal_dbm: -55 },
      {
        device_id: 11,
        client_device_id: 99,
        mac_address: 'aa:bb:cc:dd:ee:02',
        ip_address: '10.0.0.2',
        noise_floor_dbm: -90,
        snr_db: 30,
        ccq_pct: 95,
        tx_rate_mbps: 100,
        rx_rate_mbps: 50,
        distance_m: 500,
        connected_at: '2026-01-01T00:00:00Z',
        last_seen_at: '2026-01-01T01:00:00Z',
      },
    ];

    const count = await recordClientSessions(1, sessions);

    expect(count).toBe(2);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];

    // Never regress to the pool.query()-only bulk-array form.
    expect(sql).not.toContain('VALUES ?');
    expect(sql).toContain('INSERT INTO wireless_client_sessions');
    // Literal column list stays static text (so pnpm run sql:check can
    // still resolve it) — only the placeholders are interpolated.
    expect(sql).toContain('organization_id, device_id, client_device_id, mac_address, ip_address');

    const expectedPlaceholders = Array(2)
      .fill(`(${Array(14).fill('?').join(', ')})`)
      .join(', ');
    expect(sql).toContain(`VALUES ${expectedPlaceholders}`);

    // 2 rows x 14 columns = 28 flat, positionally-ordered values.
    expect(params).toHaveLength(28);
    expect(params.slice(0, 14)).toEqual([
      1, 10, null, 'aa:bb:cc:dd:ee:01', null, -55, null, null, null, null, null, null, null,
      expect.any(Date),
    ]);
    expect(params.slice(14, 28)).toEqual([
      1, 11, 99, 'aa:bb:cc:dd:ee:02', '10.0.0.2', null, -90, 30, 95, 100, 50, 500,
      '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z',
    ]);
  });

  test('single-session batch produces one placeholder group and returns its affectedRows', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const count = await recordClientSessions(2, [{ device_id: 5, mac_address: 'ff:ff:ff:ff:ff:ff' }]);

    expect(count).toBe(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain(`VALUES (${Array(14).fill('?').join(', ')})`);
    expect(params).toHaveLength(14);
    expect(params[0]).toBe(2); // organization_id
    expect(params[1]).toBe(5); // device_id
    expect(params[3]).toBe('ff:ff:ff:ff:ff:ff'); // mac_address
  });
});
