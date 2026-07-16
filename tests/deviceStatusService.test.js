// =============================================================================
// FireISP 5.0 — Device Status Service Unit Tests
// =============================================================================
// recordPollResult() no longer reads state and decides in JS — every write is
// an atomic conditional UPDATE, and the emit decision is driven entirely by
// that UPDATE's affectedRows. These tests exercise the function purely
// through the SQL shape + mocked affectedRows/rows it receives, which is also
// how the "only the winning concurrent caller emits" guarantee is verified
// (two callers racing for the same device is simulated by one mock call
// returning affectedRows: 1 and a "concurrent" one returning affectedRows: 0).
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

const isFlipToOnline  = (s) => /UPDATE devices/.test(s) && /status = 'online'/.test(s);
const isQuietSuccess  = (s) => /UPDATE devices/.test(s) && /CASE WHEN status = 'offline'/.test(s);
const isIncrement     = (s) => /consecutive_poll_failures = consecutive_poll_failures \+ 1/.test(s);
const isFlipToOffline = (s) => /UPDATE devices/.test(s) && /SET status = 'offline'/.test(s);
const isDeviceSelect  = (s) => /FROM devices WHERE id = \?/.test(s);

describe('deviceStatusService.recordPollResult', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------
  // Success path
  // ---------------------------------------------------------------------
  describe('success', () => {
    test('emits device.online when the flip UPDATE wins (affectedRows === 1) — a real detected recovery', async () => {
      db.query.mockImplementation((sql) => {
        if (isFlipToOnline(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isQuietSuccess(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isDeviceSelect(sql)) return Promise.resolve([[mockDeviceRow({ status: 'online', consecutive_poll_failures: 0 })]]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, true);

      expect(eventBus.emit).toHaveBeenCalledWith('device.online', expect.objectContaining({
        organizationId: 5,
        device: expect.objectContaining({ id: 70, status: 'online' }),
      }));

      // Quiet bookkeeping update still ran (resets last_polled_at/error even
      // though the flip UPDATE already reset the counter/status).
      expect(db.query.mock.calls.some(([sql]) => isQuietSuccess(sql))).toBe(true);
    });

    test('does NOT emit when the flip UPDATE loses the race (affectedRows === 0) — a concurrent poller already won', async () => {
      db.query.mockImplementation((sql) => {
        if (isFlipToOnline(sql)) return Promise.resolve([{ affectedRows: 0 }]); // lost the race
        if (isQuietSuccess(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, true);

      expect(eventBus.emit).not.toHaveBeenCalled();
      // No SELECT for the emit payload either — it's only fetched by the winner.
      expect(db.query.mock.calls.some(([sql]) => isDeviceSelect(sql))).toBe(false);
    });

    test('never-polled default (flip UPDATE never matches) silently sets status online via the quiet update, no emit', async () => {
      db.query.mockImplementation((sql) => {
        // The flip UPDATE's WHERE requires consecutive_poll_failures >= 3;
        // a never-polled device (failures = 0) can never satisfy it, so the
        // real MySQL driver would report affectedRows: 0 here regardless of
        // status/failures — that's exactly what we simulate.
        if (isFlipToOnline(sql)) return Promise.resolve([{ affectedRows: 0 }]);
        if (isQuietSuccess(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, true);

      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(db.query.mock.calls.some(([sql]) => isQuietSuccess(sql))).toBe(true);
    });

    test('a poll success on an already-online device is a no-op (flip never matches, no emit)', async () => {
      db.query.mockImplementation((sql) => {
        if (isFlipToOnline(sql)) return Promise.resolve([{ affectedRows: 0 }]);
        if (isQuietSuccess(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, true);

      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    test('the quiet update never touches a maintenance device (guarded by its own WHERE), no emit', async () => {
      db.query.mockImplementation((sql) => {
        if (isFlipToOnline(sql)) return Promise.resolve([{ affectedRows: 0 }]); // status != 'offline' (it's 'maintenance')
        if (isQuietSuccess(sql)) return Promise.resolve([{ affectedRows: 0 }]); // WHERE status != 'maintenance' excludes it
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, true);

      expect(eventBus.emit).not.toHaveBeenCalled();
      const quietCall = db.query.mock.calls.find(([sql]) => isQuietSuccess(sql));
      expect(quietCall[0]).toMatch(/status != 'maintenance'/);
    });

    test('runs the flip UPDATE before the quiet UPDATE (order matters — quiet must not race its own emit decision)', async () => {
      const order = [];
      db.query.mockImplementation((sql) => {
        if (isFlipToOnline(sql)) { order.push('flip'); return Promise.resolve([{ affectedRows: 1 }]); }
        if (isQuietSuccess(sql)) { order.push('quiet'); return Promise.resolve([{ affectedRows: 1 }]); }
        if (isDeviceSelect(sql)) return Promise.resolve([[mockDeviceRow()]]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, true);

      expect(order).toEqual(['flip', 'quiet']);
    });
  });

  // ---------------------------------------------------------------------
  // Failure path
  // ---------------------------------------------------------------------
  describe('failure', () => {
    test('increments atomically (col = col + 1) unconditionally, regardless of device status', async () => {
      db.query.mockImplementation((sql) => {
        if (isIncrement(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isFlipToOffline(sql)) return Promise.resolve([{ affectedRows: 0 }]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, false, 'timeout');

      const incrementCall = db.query.mock.calls.find(([sql]) => isIncrement(sql));
      expect(incrementCall).toBeDefined();
      expect(incrementCall[0]).toMatch(/last_polled_at = NOW\(\)/);
      expect(incrementCall[1]).toEqual(['timeout', 70]);
    });

    test('emits device.offline when the flip UPDATE wins (affectedRows === 1) — threshold crossed', async () => {
      db.query.mockImplementation((sql) => {
        if (isIncrement(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isFlipToOffline(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isDeviceSelect(sql)) return Promise.resolve([[mockDeviceRow({ status: 'offline', consecutive_poll_failures: 3 })]]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, false, 'timeout');

      expect(eventBus.emit).toHaveBeenCalledWith('device.offline', expect.objectContaining({
        organizationId: 5,
        device: expect.objectContaining({ id: 70, status: 'offline', consecutive_poll_failures: 3 }),
      }));
    });

    test('does NOT emit when the flip UPDATE loses the race (a concurrent poller already flipped it offline)', async () => {
      db.query.mockImplementation((sql) => {
        if (isIncrement(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isFlipToOffline(sql)) return Promise.resolve([{ affectedRows: 0 }]); // already 'offline' by the time this ran
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, false, 'timeout');

      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(db.query.mock.calls.some(([sql]) => isDeviceSelect(sql))).toBe(false);
    });

    test('a flap below the threshold does not flip or emit (flip UPDATE never matches)', async () => {
      db.query.mockImplementation((sql) => {
        if (isIncrement(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isFlipToOffline(sql)) return Promise.resolve([{ affectedRows: 0 }]); // consecutive_poll_failures < 3
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, false, 'timeout');

      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    test('never flips (or emits for) a device whose status is maintenance, even past the failure threshold', async () => {
      db.query.mockImplementation((sql) => {
        if (isIncrement(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        // WHERE status NOT IN ('offline','maintenance') excludes a
        // maintenance device even though consecutive_poll_failures >= 3.
        if (isFlipToOffline(sql)) return Promise.resolve([{ affectedRows: 0 }]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, false, 'timeout');

      const flipCall = db.query.mock.calls.find(([sql]) => isFlipToOffline(sql));
      expect(flipCall[0]).toMatch(/status NOT IN \('offline', 'maintenance'\)/);
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    test('runs the increment UPDATE before the flip UPDATE (the flip depends on the just-incremented value)', async () => {
      const order = [];
      db.query.mockImplementation((sql) => {
        if (isIncrement(sql)) { order.push('increment'); return Promise.resolve([{ affectedRows: 1 }]); }
        if (isFlipToOffline(sql)) { order.push('flip'); return Promise.resolve([{ affectedRows: 1 }]); }
        if (isDeviceSelect(sql)) return Promise.resolve([[mockDeviceRow()]]);
        return Promise.resolve([[]]);
      });

      await deviceStatusService.recordPollResult(70, false, 'timeout');

      expect(order).toEqual(['increment', 'flip']);
    });
  });

  // ---------------------------------------------------------------------
  // Concurrency simulation — two "simultaneous" callers for the same device
  // ---------------------------------------------------------------------
  describe('concurrent callers for the same device', () => {
    test('only the winning caller (affectedRows === 1) emits device.offline; the loser is a silent no-op', async () => {
      let flipCallCount = 0;
      db.query.mockImplementation((sql) => {
        if (isIncrement(sql)) return Promise.resolve([{ affectedRows: 1 }]);
        if (isFlipToOffline(sql)) {
          flipCallCount += 1;
          // First caller's UPDATE "wins" (MySQL row-lock semantics: whichever
          // statement's WHERE clause is evaluated against the not-yet-offline
          // row matches); the second sees the already-'offline' row and
          // matches nothing.
          return Promise.resolve([{ affectedRows: flipCallCount === 1 ? 1 : 0 }]);
        }
        if (isDeviceSelect(sql)) return Promise.resolve([[mockDeviceRow({ status: 'offline', consecutive_poll_failures: 3 })]]);
        return Promise.resolve([[]]);
      });

      await Promise.all([
        deviceStatusService.recordPollResult(70, false, 'timeout A'),
        deviceStatusService.recordPollResult(70, false, 'timeout B'),
      ]);

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith('device.offline', expect.anything());
    });
  });
});
