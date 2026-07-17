// =============================================================================
// FireISP 5.0 — Speed Window Service Tests (§10.2)
// =============================================================================
// applySpeedWindows converges radgroupreply (persisted applied state) to the
// window in force and CoAs live sessions ONLY on transitions, carrying the
// vendor rate-limit attributes. State writes are transactional.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));
jest.mock('../src/services/radiusService', () => ({
  changeOfAuth: jest.fn(),
}));

const db = require('../src/config/database');
const radiusService = require('../src/services/radiusService');
const { getActiveWindow, windowEffectivePlan, applySpeedWindows } = require('../src/services/speedWindowService');

// Mikrotik plan: 100M/20M CIR → plan rate string "100M/20M 200M/40M 100M/20M 8"
const PLAN = {
  id: 5,
  download_speed_mbps: 100,
  upload_speed_mbps: 20,
  burst_download_mbps: null,
  burst_upload_mbps: null,
  burst_threshold_mbps: null,
  burst_time_seconds: null,
  radius_vendor: 'mikrotik',
  priority: null,
};
const PLAN_RATE = '100M/20M 200M/40M 100M/20M 8';

// Night window 50M/10M → "50M/10M 100M/20M 50M/10M 8"
const WINDOW = { id: 1, plan_id: 5, label: 'Night', download_speed_mbps: 50, upload_speed_mbps: 10, priority: 10 };
const WINDOW_RATE = '50M/10M 100M/20M 50M/10M 8';

let conn;

describe('speedWindowService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conn = {
      execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
      beginTransaction: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);
  });

  describe('getActiveWindow()', () => {
    it('returns window when one matches current time and day', async () => {
      db.query.mockResolvedValueOnce([[WINDOW]]);
      const result = await getActiveWindow(5);
      expect(result).toEqual(WINDOW);
    });

    it('returns null when no window matches', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await getActiveWindow(5);
      expect(result).toBeNull();
    });
  });

  describe('windowEffectivePlan()', () => {
    it('overrides CIR with window speeds and clears bursts so they re-derive', () => {
      const eff = windowEffectivePlan(
        { ...PLAN, burst_download_mbps: 400, burst_threshold_mbps: 90, priority: 3 },
        WINDOW,
      );
      expect(eff.download_speed_mbps).toBe(50);
      expect(eff.upload_speed_mbps).toBe(10);
      expect(eff.burst_download_mbps).toBeNull();
      expect(eff.burst_upload_mbps).toBeNull();
      expect(eff.burst_threshold_mbps).toBeNull();
      expect(eff.radius_vendor).toBe('mikrotik');
      expect(eff.priority).toBe(3);
    });
  });

  describe('applySpeedWindows()', () => {
    it('engages a window: transactionally rewrites radgroupreply speed rows and CoAs live contracts', async () => {
      db.query
        .mockResolvedValueOnce([[PLAN]]) // windowed plans
        .mockResolvedValueOnce([[WINDOW]]) // getActiveWindow
        .mockResolvedValueOnce([[{ attribute: 'Mikrotik-Rate-Limit', value: PLAN_RATE }]]) // current state = plan attrs
        .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }]]); // active contracts
      radiusService.changeOfAuth.mockResolvedValue({ sent: true, response: 'CoA-ACK' });

      const result = await applySpeedWindows(1);

      expect(result.transitions).toBe(1);
      expect(result.coa_sent).toBe(2);
      expect(result.unchanged).toBe(0);

      expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
      const deleteCall = conn.execute.mock.calls.find(([sql]) => sql.includes('DELETE FROM radgroupreply'));
      expect(deleteCall[1][0]).toBe('plan_5');
      const insertCall = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO radgroupreply'));
      expect(insertCall[1]).toEqual(['plan_5', 'Mikrotik-Rate-Limit', '=', WINDOW_RATE]);

      expect(radiusService.changeOfAuth).toHaveBeenCalledWith(
        10, 'update', [{ name: 'Mikrotik-Rate-Limit', value: WINDOW_RATE }],
      );
      expect(radiusService.changeOfAuth).toHaveBeenCalledWith(
        11, 'update', [{ name: 'Mikrotik-Rate-Limit', value: WINDOW_RATE }],
      );
    });

    it('is quiet at steady state: matching radgroupreply rows mean no writes and no CoA', async () => {
      db.query
        .mockResolvedValueOnce([[PLAN]])
        .mockResolvedValueOnce([[WINDOW]])
        .mockResolvedValueOnce([[{ attribute: 'Mikrotik-Rate-Limit', value: WINDOW_RATE }]]); // already applied

      const result = await applySpeedWindows(1);

      expect(result.unchanged).toBe(1);
      expect(result.transitions).toBe(0);
      expect(radiusService.changeOfAuth).not.toHaveBeenCalled();
      expect(db.getConnection).not.toHaveBeenCalled();
      expect(conn.execute).not.toHaveBeenCalled();
    });

    it('restores PLAN speeds when the window ends', async () => {
      db.query
        .mockResolvedValueOnce([[PLAN]])
        .mockResolvedValueOnce([[]]) // no active window
        .mockResolvedValueOnce([[{ attribute: 'Mikrotik-Rate-Limit', value: WINDOW_RATE }]]) // window attrs still applied
        .mockResolvedValueOnce([[{ id: 10 }]]);
      radiusService.changeOfAuth.mockResolvedValue({ sent: true });

      const result = await applySpeedWindows(1);

      expect(result.transitions).toBe(1);
      const insertCall = conn.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO radgroupreply'));
      expect(insertCall[1]).toEqual(['plan_5', 'Mikrotik-Rate-Limit', '=', PLAN_RATE]);
      expect(radiusService.changeOfAuth).toHaveBeenCalledWith(
        10, 'update', [{ name: 'Mikrotik-Rate-Limit', value: PLAN_RATE }],
      );
    });

    it('rolls back and counts an error when the state write fails mid-transaction', async () => {
      db.query
        .mockResolvedValueOnce([[PLAN]])
        .mockResolvedValueOnce([[WINDOW]])
        .mockResolvedValueOnce([[]]); // transition
      conn.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // DELETE ok
        .mockRejectedValueOnce(new Error('deadlock')); // INSERT fails

      const result = await applySpeedWindows(1);

      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalledTimes(1);
      expect(result.errors).toBe(1);
      expect(result.transitions).toBe(0);
      expect(radiusService.changeOfAuth).not.toHaveBeenCalled();
    });

    it('writes state but skips CoA for juniper (no ERX CoA encoder)', async () => {
      db.query
        .mockResolvedValueOnce([[{ ...PLAN, radius_vendor: 'juniper' }]])
        .mockResolvedValueOnce([[WINDOW]])
        .mockResolvedValueOnce([[]]); // no current rows → transition

      const result = await applySpeedWindows(1);

      expect(result.transitions).toBe(1);
      expect(result.coa_skipped_vendor).toBe(1);
      expect(radiusService.changeOfAuth).not.toHaveBeenCalled();
      const inserts = conn.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO radgroupreply'));
      expect(inserts).toHaveLength(2); // ERX-Qos-Profile-Name + ERX-Input-Gigapkts
    });

    it('counts CoA failures and undeliverable contracts separately', async () => {
      db.query
        .mockResolvedValueOnce([[PLAN]])
        .mockResolvedValueOnce([[WINDOW]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }, { id: 12 }]]);
      radiusService.changeOfAuth
        .mockResolvedValueOnce({ sent: true, response: 'CoA-ACK' })
        .mockResolvedValueOnce({ sent: false, response: 'No RADIUS account found for contract' })
        .mockRejectedValueOnce(new Error('socket error'));

      const result = await applySpeedWindows(1);

      expect(result.coa_sent).toBe(1);
      expect(result.coa_skipped_no_radius).toBe(1);
      expect(result.coa_errors).toBe(1);
    });

    it('returns zeroed summary when no plans have windows', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await applySpeedWindows(1);
      expect(result.plans_checked).toBe(0);
      expect(result.transitions).toBe(0);
    });
  });
});
