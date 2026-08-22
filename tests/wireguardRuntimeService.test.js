'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(fn => fn()),
}));
jest.mock('../src/services/wireguardServerService', () => ({
  bootstrapHost: jest.fn().mockResolvedValue({ applied: true }),
  shutdownHost: jest.fn().mockResolvedValue({ applied: true }),
}));
jest.mock('../src/services/wgProvisioningService', () => ({
  rehydrateNasPeers: jest.fn().mockResolvedValue({ rehydrated: 0 }),
}));
jest.mock('../src/services/userTunnelService', () => ({
  rehydrateUserPeers: jest.fn().mockResolvedValue({ rehydrated: 0 }),
}));
jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn() }),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const kernel = require('../src/services/wireguardServerService');
const nasPeers = require('../src/services/wgProvisioningService');
const userPeers = require('../src/services/userTunnelService');
const runtime = require('../src/services/wireguardRuntimeService');

describe('WireGuard GUI runtime state', () => {
  const originalLegacy = process.env.WG_LEGACY_SERVER_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    config.wireguard.serverEnabled = false;
    kernel.bootstrapHost.mockResolvedValue({ applied: true });
    kernel.shutdownHost.mockResolvedValue({ applied: true });
    delete process.env.WG_LEGACY_SERVER_ENABLED;
  });

  afterAll(() => {
    if (originalLegacy === undefined) delete process.env.WG_LEGACY_SERVER_ENABLED;
    else process.env.WG_LEGACY_SERVER_ENABLED = originalLegacy;
  });

  test('starts disabled from the persisted secure default', async () => {
    db.query.mockResolvedValue([[{ setting_value: 'false' }]]);
    await expect(runtime.initialize()).resolves.toEqual({ enabled: false });
    expect(kernel.bootstrapHost).not.toHaveBeenCalled();
  });

  test('enabling provisions the hub and restores both peer sets', async () => {
    await expect(runtime.setEnabled(true)).resolves.toEqual({ enabled: true });
    expect(kernel.bootstrapHost).toHaveBeenCalled();
    expect(nasPeers.rehydrateNasPeers).toHaveBeenCalled();
    expect(userPeers.rehydrateUserPeers).toHaveBeenCalled();
    expect(config.wireguard.serverEnabled).toBe(true);
  });

  test('one-time migration preserves an existing default-on installation', async () => {
    process.env.WG_LEGACY_SERVER_ENABLED = '__unset__';
    db.query
      .mockResolvedValueOnce([[{ setting_value: 'migrate' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(runtime.initialize()).resolves.toEqual({ enabled: true });
    expect(db.query).toHaveBeenCalledWith(
      'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
      ['true', 'wireguard_server_enabled'],
    );
  });

  test('one-time migration keeps fresh installs explicitly disabled', async () => {
    process.env.WG_LEGACY_SERVER_ENABLED = 'false';
    db.query
      .mockResolvedValueOnce([[{ setting_value: 'migrate' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(runtime.initialize()).resolves.toEqual({ enabled: false });
    expect(db.query).toHaveBeenCalledWith(
      'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
      ['false', 'wireguard_server_enabled'],
    );
  });

  test('disabling tears down kernel state before marking the hub disabled', async () => {
    config.wireguard.serverEnabled = true;
    await expect(runtime.setEnabled(false)).resolves.toEqual({ enabled: false });
    expect(kernel.shutdownHost).toHaveBeenCalled();
    expect(config.wireguard.serverEnabled).toBe(false);
  });
});
