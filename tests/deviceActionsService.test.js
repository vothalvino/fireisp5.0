// =============================================================================
// FireISP 5.0 — deviceActionsService.rebootDevice tests
// =============================================================================
// Verifies reboot routes to the real mechanism per device type/driver, and
// refuses honestly (ValidationError) when none exists — never fake success.
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/ftthService', () => ({ scheduleOnuReboot: jest.fn() }));
jest.mock('../src/services/routerDriverService', () => ({ dispatchCommand: jest.fn() }));

const db = require('../src/config/database');
const ftthService = require('../src/services/ftthService');
const routerDriverService = require('../src/services/routerDriverService');
const { rebootDevice } = require('../src/services/deviceActionsService');
const { NotFoundError, ValidationError } = require('../src/utils/errors');

const q = (rows) => [rows, []];

beforeEach(() => jest.resetAllMocks());

describe('deviceActionsService.rebootDevice', () => {
  test('throws NotFoundError when the device is not in the org', async () => {
    db.query.mockResolvedValueOnce(q([])); // device lookup: none
    await expect(rebootDevice(99, 10, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('ONU device → delegates to ftthService.scheduleOnuReboot', async () => {
    db.query
      .mockResolvedValueOnce(q([{ id: 5, name: 'onu-1', type: 'onu', status: 'online' }])) // device
      .mockResolvedValueOnce(q([{ device_id: 5, olt_device_id: 3 }])); // onu_details
    ftthService.scheduleOnuReboot.mockResolvedValue({ id: 77 });

    const res = await rebootDevice(5, 10, 1);
    expect(ftthService.scheduleOnuReboot).toHaveBeenCalledWith(5, 3, 10, 1);
    expect(res).toEqual({ method: 'onu_job', status: 'queued', detail: { job_id: 77 } });
    expect(routerDriverService.dispatchCommand).not.toHaveBeenCalled();
  });

  test('ONU without an onu_details row → ValidationError (cannot resolve OLT)', async () => {
    db.query
      .mockResolvedValueOnce(q([{ id: 5, name: 'onu-1', type: 'onu', status: 'online' }]))
      .mockResolvedValueOnce(q([])); // no onu_details
    await expect(rebootDevice(5, 10, 1)).rejects.toBeInstanceOf(ValidationError);
  });

  test('device with a MikroTik driver config → dispatches a real reboot command', async () => {
    db.query
      .mockResolvedValueOnce(q([{ id: 9, name: 'core-rtr', type: 'router', status: 'online' }])) // device
      .mockResolvedValueOnce(q([{ id: 44 }])); // driver config
    routerDriverService.dispatchCommand.mockResolvedValue({ status: 'success', execution_id: 123 });

    const res = await rebootDevice(9, 10, 7);
    expect(routerDriverService.dispatchCommand).toHaveBeenCalledWith(44, 10, 'reboot', {}, 7);
    expect(res).toEqual({ method: 'mikrotik_driver', status: 'issued', detail: { execution_id: 123 } });
  });

  test('MikroTik dispatch that fails → surfaces the failure (no fake success)', async () => {
    db.query
      .mockResolvedValueOnce(q([{ id: 9, name: 'core-rtr', type: 'router', status: 'online' }]))
      .mockResolvedValueOnce(q([{ id: 44 }]));
    routerDriverService.dispatchCommand.mockResolvedValue({ status: 'failure', error_message: 'reboot refused' });

    await expect(rebootDevice(9, 10, 7)).rejects.toThrow(/reboot refused/);
  });

  test('router with no driver config → ValidationError (not supported), never faked', async () => {
    db.query
      .mockResolvedValueOnce(q([{ id: 9, name: 'switch-x', type: 'switch', status: 'online' }])) // device
      .mockResolvedValueOnce(q([])); // no driver config
    await expect(rebootDevice(9, 10, 1)).rejects.toThrow(/not supported/i);
    expect(routerDriverService.dispatchCommand).not.toHaveBeenCalled();
    expect(ftthService.scheduleOnuReboot).not.toHaveBeenCalled();
  });
});
