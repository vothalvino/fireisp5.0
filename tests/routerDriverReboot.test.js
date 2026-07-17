// =============================================================================
// FireISP 5.0 — routerDriverService MikroTik reboot dispatch tests
// =============================================================================
// Covers the new 'reboot' command mapping and the silent-no-op fix: an
// unmapped MikroTik command now records status 'failure', not 'success'.
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/utils/encryption', () => ({
  encrypt: jest.fn(v => `enc(${v})`),
  decrypt: jest.fn(v => v),
}));
jest.mock('../src/services/routerosService', () => ({
  systemReboot: jest.fn(),
}));

const db = require('../src/config/database');
const routerosService = require('../src/services/routerosService');
const routerDriverService = require('../src/services/routerDriverService');

const q = (rows) => [rows, []];
const insertResult = (id) => [{ insertId: id }, []];

const mikrotikConfig = {
  id: 1, vendor: 'mikrotik', device_id: 9, host: '10.0.0.1', port: 8728,
  username: 'admin', encrypted_password: 'enc(secret)',
};

beforeEach(() => jest.resetAllMocks());

describe('routerDriverService.dispatchCommand — MikroTik', () => {
  test("'reboot' calls routerosService.systemReboot and records success", async () => {
    db.query
      .mockResolvedValueOnce(q([mikrotikConfig])) // config lookup
      .mockResolvedValueOnce(insertResult(50)); // execution insert
    routerosService.systemReboot.mockResolvedValue({ rebooted: true, host: '10.0.0.1' });

    const result = await routerDriverService.dispatchCommand(1, 1, 'reboot', {}, 7);
    expect(routerosService.systemReboot).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    // status is the 7th bound param (index 6) of the execution INSERT
    expect(db.query.mock.calls[1][1][6]).toBe('success');
  });

  test('an UNMAPPED MikroTik command records failure, never success (silent no-op fix)', async () => {
    db.query
      .mockResolvedValueOnce(q([mikrotikConfig]))
      .mockResolvedValueOnce(insertResult(51));

    const result = await routerDriverService.dispatchCommand(1, 1, 'totally_unknown_cmd', {}, 7);
    expect(result.status).toBe('failure');
    expect(result.error_message).toMatch(/not mapped/i);
    expect(db.query.mock.calls[1][1][6]).toBe('failure');
    expect(routerosService.systemReboot).not.toHaveBeenCalled();
  });

  test('a reboot refused by the device records failure', async () => {
    db.query
      .mockResolvedValueOnce(q([mikrotikConfig]))
      .mockResolvedValueOnce(insertResult(52));
    routerosService.systemReboot.mockRejectedValue(new Error('RouterOS reboot refused: not enough permissions'));

    const result = await routerDriverService.dispatchCommand(1, 1, 'reboot', {}, 7);
    expect(result.status).toBe('failure');
    expect(result.error_message).toMatch(/refused/i);
  });
});
