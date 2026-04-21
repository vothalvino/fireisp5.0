// =============================================================================
// FireISP 5.0 — Config Backup Service Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }),
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/firerelayTunnel', () => ({
  tunnelServer: {
    sendCommand: jest.fn(),
    isConnected: jest.fn(),
  },
}));

const db = require('../src/config/database');
const { tunnelServer } = require('../src/services/firerelayTunnel');
const {
  pullBackupForDevice,
  runNightlyBackups,
  sha256,
  getLatestVersion,
  getLatestChecksum,
} = require('../src/services/configBackupService');

// =============================================================================
// sha256 helper
// =============================================================================

describe('sha256', () => {
  test('returns a 64-char hex string', () => {
    const hash = sha256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  test('same input → same hash', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
  });

  test('different input → different hash', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});

// =============================================================================
// getLatestVersion
// =============================================================================

describe('getLatestVersion', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns 0 when no backups exist', async () => {
    db.query.mockResolvedValueOnce([[]]);
    expect(await getLatestVersion(1)).toBe(0);
  });

  test('returns highest version number', async () => {
    db.query.mockResolvedValueOnce([[{ version: 5 }]]);
    expect(await getLatestVersion(1)).toBe(5);
  });
});

// =============================================================================
// getLatestChecksum
// =============================================================================

describe('getLatestChecksum', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns null when no backups exist', async () => {
    db.query.mockResolvedValueOnce([[]]);
    expect(await getLatestChecksum(1)).toBeNull();
  });

  test('returns the checksum of the latest backup', async () => {
    const hash = sha256('config content');
    db.query.mockResolvedValueOnce([[{ checksum: hash }]]);
    expect(await getLatestChecksum(1)).toBe(hash);
  });
});

// =============================================================================
// pullBackupForDevice
// =============================================================================

describe('pullBackupForDevice', () => {
  const DEVICE_OPTS = {
    deviceId: 42,
    nodeId: 'node-1',
    host: '192.168.1.1',
    user: 'admin',
    password: 'secret',
  };

  afterEach(() => jest.clearAllMocks());

  test('stores a new backup when no previous backup exists', async () => {
    const content = '# RouterOS config\n/system identity\nset name=Router1';
    const checksum = sha256(content);

    tunnelServer.sendCommand.mockResolvedValueOnce({ content, configType: 'mikrotik_export' });
    db.query
      .mockResolvedValueOnce([[]])          // getLatestChecksum — no prior
      .mockResolvedValueOnce([[]])          // getLatestVersion — no prior
      .mockResolvedValueOnce([{ insertId: 7 }]); // INSERT

    const result = await pullBackupForDevice(DEVICE_OPTS);

    expect(result.skipped).toBe(false);
    expect(result.backupId).toBe(7);
    expect(result.version).toBe(1);
    expect(result.checksum).toBe(checksum);
    expect(result.configType).toBe('mikrotik_export');

    // Verify tunnelServer was called correctly
    expect(tunnelServer.sendCommand).toHaveBeenCalledWith(
      'node-1',
      'config.backup',
      expect.objectContaining({ host: '192.168.1.1', user: 'admin', password: 'secret', compact: false }),
    );
  });

  test('increments version when a previous backup exists', async () => {
    const content = 'new config';
    const oldChecksum = sha256('old config');
    const newChecksum = sha256(content);

    tunnelServer.sendCommand.mockResolvedValueOnce({ content, configType: 'mikrotik_export' });
    db.query
      .mockResolvedValueOnce([[{ checksum: oldChecksum }]])  // getLatestChecksum
      .mockResolvedValueOnce([[{ version: 3 }]])             // getLatestVersion
      .mockResolvedValueOnce([{ insertId: 12 }]);            // INSERT

    const result = await pullBackupForDevice(DEVICE_OPTS);

    expect(result.skipped).toBe(false);
    expect(result.version).toBe(4);
    expect(result.checksum).toBe(newChecksum);
  });

  test('skips storage when checksum matches latest', async () => {
    const content = 'identical config';
    const checksum = sha256(content);

    tunnelServer.sendCommand.mockResolvedValueOnce({ content, configType: 'mikrotik_export' });
    db.query.mockResolvedValueOnce([[{ checksum }]]); // getLatestChecksum — same hash

    const result = await pullBackupForDevice(DEVICE_OPTS);

    expect(result.skipped).toBe(true);
    expect(result.checksum).toBe(checksum);
    expect(result.backupId).toBeNull();

    // Should NOT have called INSERT
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('passes compact=true when requested', async () => {
    const content = '# compact config';
    tunnelServer.sendCommand.mockResolvedValueOnce({ content, configType: 'mikrotik_compact' });
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 1 }]);

    const result = await pullBackupForDevice({ ...DEVICE_OPTS, compact: true });

    expect(result.configType).toBe('mikrotik_compact');
    expect(tunnelServer.sendCommand).toHaveBeenCalledWith(
      'node-1',
      'config.backup',
      expect.objectContaining({ compact: true }),
    );
  });

  test('throws when deviceId is missing', async () => {
    await expect(
      pullBackupForDevice({ ...DEVICE_OPTS, deviceId: undefined }),
    ).rejects.toThrow('deviceId is required');
  });

  test('throws when nodeId is missing', async () => {
    await expect(
      pullBackupForDevice({ ...DEVICE_OPTS, nodeId: undefined }),
    ).rejects.toThrow('nodeId is required');
  });

  test('throws when host is missing', async () => {
    await expect(
      pullBackupForDevice({ ...DEVICE_OPTS, host: undefined }),
    ).rejects.toThrow('host is required');
  });

  test('throws when user is missing', async () => {
    await expect(
      pullBackupForDevice({ ...DEVICE_OPTS, user: undefined }),
    ).rejects.toThrow('user is required');
  });

  test('throws when password is missing', async () => {
    await expect(
      pullBackupForDevice({ ...DEVICE_OPTS, password: undefined }),
    ).rejects.toThrow('password is required');
  });

  test('propagates tunnel errors', async () => {
    tunnelServer.sendCommand.mockRejectedValueOnce(new Error('Agent timed out'));
    await expect(pullBackupForDevice(DEVICE_OPTS)).rejects.toThrow('Agent timed out');
  });
});

// =============================================================================
// runNightlyBackups
// =============================================================================

describe('runNightlyBackups', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.ROUTEROS_API_USER = 'admin';
    process.env.ROUTEROS_API_PASSWORD = 'nightlypass';
    delete process.env.ROUTEROS_API_PORT;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    jest.clearAllMocks();
  });

  test('returns zeros when ROUTEROS_API_PASSWORD is not set', async () => {
    delete process.env.ROUTEROS_API_PASSWORD;
    const result = await runNightlyBackups();
    expect(result).toEqual({ total: 0, backed_up: 0, skipped: 0, failed: 0 });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('counts backed_up, skipped, and failed correctly', async () => {
    const devices = [
      { id: 1, name: 'Router A', ip_address: '10.0.0.1', firerelay_node_id: 'node-1' },
      { id: 2, name: 'Router B', ip_address: '10.0.0.2', firerelay_node_id: 'node-1' },
      { id: 3, name: 'Router C', ip_address: '10.0.0.3', firerelay_node_id: 'node-2' },
    ];

    db.query.mockResolvedValueOnce([devices]); // device list query

    tunnelServer.isConnected
      .mockReturnValueOnce(true)   // device 1 — connected
      .mockReturnValueOnce(true)   // device 2 — connected
      .mockReturnValueOnce(false); // device 3 — not connected → failed

    const contentA = '# config A';
    const contentB = '# config B (unchanged)';
    const checksumB = sha256(contentB);

    // Device 1: new backup
    tunnelServer.sendCommand.mockResolvedValueOnce({ content: contentA, configType: 'mikrotik_export' });
    db.query
      .mockResolvedValueOnce([[]])                    // getLatestChecksum (no prior)
      .mockResolvedValueOnce([[]])                    // getLatestVersion (no prior)
      .mockResolvedValueOnce([{ insertId: 10 }]);     // INSERT

    // Device 2: unchanged (skipped)
    tunnelServer.sendCommand.mockResolvedValueOnce({ content: contentB, configType: 'mikrotik_export' });
    db.query
      .mockResolvedValueOnce([[{ checksum: checksumB }]]); // getLatestChecksum — same

    const result = await runNightlyBackups();

    expect(result.total).toBe(3);
    expect(result.backed_up).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
  });

  test('counts a device as failed when tunnel throws', async () => {
    const devices = [
      { id: 1, name: 'Router A', ip_address: '10.0.0.1', firerelay_node_id: 'node-1' },
    ];

    db.query.mockResolvedValueOnce([devices]);
    tunnelServer.isConnected.mockReturnValueOnce(true);
    tunnelServer.sendCommand.mockRejectedValueOnce(new Error('command timeout'));

    const result = await runNightlyBackups();

    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.backed_up).toBe(0);
  });

  test('handles empty device list gracefully', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await runNightlyBackups();
    expect(result).toEqual({ total: 0, backed_up: 0, skipped: 0, failed: 0 });
  });
});
