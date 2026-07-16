// =============================================================================
// FireISP 5.0 — Device Status Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const deviceStatusService = require('../src/services/deviceStatusService');

function mockDeviceRow(overrides = {}) {
  return {
    id: 70, organization_id: 5, name: 'AP-Tower-1', ip_address: '10.0.0.1',
    type: 'ptmp_ap', status: 'online', consecutive_poll_failures: 0,
    ...overrides,
  };
}

describe('deviceStatusService.recordPollResult', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does nothing when the device cannot be found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await deviceStatusService.recordPollResult(999, true);
    expect(db.query).toHaveBeenCalledTimes(1); // no UPDATE issued
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Threshold crossing (offline)
  // ---------------------------------------------------------------------
  test('flips to offline and emits device.offline on the 3rd consecutive failure', async () => {
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'online', consecutive_poll_failures: 2 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, false, 'timeout');

    const update = db.query.mock.calls[1];
    expect(update[0]).toMatch(/UPDATE devices/);
    expect(update[1]).toEqual(['timeout', 3, 'offline', 70]);

    expect(eventBus.emit).toHaveBeenCalledWith('device.offline', expect.objectContaining({
      organizationId: 5,
      device: expect.objectContaining({ id: 70, status: 'offline', consecutive_poll_failures: 3 }),
    }));
  });

  // ---------------------------------------------------------------------
  // Flap below threshold
  // ---------------------------------------------------------------------
  test('does not flip or emit when failures stay below the threshold (flap)', async () => {
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'online', consecutive_poll_failures: 0 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, false, 'timeout');

    const update = db.query.mock.calls[1];
    expect(update[1]).toEqual(['timeout', 1, 'online', 70]); // status unchanged
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test('a flap that recovers before crossing the threshold resets the counter with no emit', async () => {
    // Device already has 2 failures (still 'online', below threshold), then a
    // successful poll arrives.
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'online', consecutive_poll_failures: 2 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, true);

    const update = db.query.mock.calls[1];
    expect(update[0]).toMatch(/UPDATE devices/);
    expect(update[1]).toEqual(['online', 70]); // status stays 'online', counter reset to 0
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // maintenance status is never auto-flipped
  // ---------------------------------------------------------------------
  test('never flips a device whose status is maintenance, even past the failure threshold', async () => {
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'maintenance', consecutive_poll_failures: 5 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, false, 'timeout');

    const update = db.query.mock.calls[1];
    expect(update[1]).toEqual(['timeout', 6, 'maintenance', 70]); // status untouched
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test('a successful poll on a maintenance device leaves it in maintenance (never auto-online)', async () => {
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'maintenance', consecutive_poll_failures: 0 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, true);

    const update = db.query.mock.calls[1];
    expect(update[1]).toEqual(['maintenance', 70]);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // First-poll / never-polled default: no stampede
  // ---------------------------------------------------------------------
  test('a never-polled device (offline default, 0 failures) flips to online silently on its first successful poll', async () => {
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'offline', consecutive_poll_failures: 0 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, true);

    const update = db.query.mock.calls[1];
    expect(update[1]).toEqual(['online', 70]); // status column DOES flip...
    expect(eventBus.emit).not.toHaveBeenCalled(); // ...but no notification stampede
  });

  // ---------------------------------------------------------------------
  // Detector-driven recovery
  // ---------------------------------------------------------------------
  test('emits device.online and resets the counter when a REAL detected outage recovers', async () => {
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'offline', consecutive_poll_failures: 4 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, true);

    const update = db.query.mock.calls[1];
    expect(update[1]).toEqual(['online', 70]);
    expect(eventBus.emit).toHaveBeenCalledWith('device.online', expect.objectContaining({
      organizationId: 5,
      device: expect.objectContaining({ id: 70, status: 'online', consecutive_poll_failures: 0 }),
    }));
  });

  test('a poll success on an already-online device is a no-op (no status write side effect, no emit)', async () => {
    db.query
      .mockResolvedValueOnce([[mockDeviceRow({ status: 'online', consecutive_poll_failures: 0 })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await deviceStatusService.recordPollResult(70, true);

    const update = db.query.mock.calls[1];
    expect(update[1]).toEqual(['online', 70]);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
