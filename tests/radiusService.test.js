// =============================================================================
// FireISP 5.0 — RADIUS Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/suspensionService', () => ({
  sendRadiusDisconnect: jest.fn(),
  sendRadiusCoA: jest.fn(),
}));

const db = require('../src/config/database');
const { sendRadiusDisconnect, sendRadiusCoA } = require('../src/services/suspensionService');
const radiusService = require('../src/services/radiusService');

describe('radiusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('syncAccount()', () => {
    test('syncs status when contract is active', async () => {
      db.query
        .mockResolvedValueOnce([[{
          contract_id: 1, contract_status: 'active',
          download_speed: 100, upload_speed: 50, plan_name: 'Premium',
          radius_id: 10, username: 'user1', radius_status: 'disabled',
        }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await radiusService.syncAccount(1);
      expect(result.synced).toBe(true);
      expect(result.status).toBe('active');
      expect(db.query).toHaveBeenCalledWith(
        'UPDATE radius SET status = ? WHERE id = ?',
        ['active', 10],
      );
    });

    test('returns not synced when contract not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await radiusService.syncAccount(999);
      expect(result.synced).toBe(false);
    });

    test('returns not synced when no RADIUS account', async () => {
      db.query.mockResolvedValueOnce([[{
        contract_id: 1, contract_status: 'active',
        radius_id: null, username: null,
      }]]);

      const result = await radiusService.syncAccount(1);
      expect(result.synced).toBe(false);
    });
  });

  describe('syncAllAccounts()', () => {
    test('syncs all accounts for an organization', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]])  // list contracts
        // syncAccount for contract 1
        .mockResolvedValueOnce([[{ contract_id: 1, contract_status: 'active', radius_id: 10, username: 'u1', radius_status: 'active', download_speed: 100, upload_speed: 50, plan_name: 'P1' }]])
        // syncAccount for contract 2
        .mockResolvedValueOnce([[{ contract_id: 2, contract_status: 'active', radius_id: 20, username: 'u2', radius_status: 'active', download_speed: 50, upload_speed: 25, plan_name: 'P2' }]]);

      const result = await radiusService.syncAllAccounts(1);
      expect(result.synced).toBe(2);
      expect(result.errors).toBe(0);
    });
  });

  describe('getActiveSession()', () => {
    test('returns most recent active session', async () => {
      const session = { id: 1, session_id: 'sess123', event_type: 'start', event_at: '2026-03-15' };
      db.query.mockResolvedValueOnce([[session]]);

      const result = await radiusService.getActiveSession(1);
      expect(result).toEqual(session);
    });

    test('returns null when no active session', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await radiusService.getActiveSession(1);
      expect(result).toBeNull();
    });
  });

  describe('disconnectSession()', () => {
    test('delegates to suspensionService', async () => {
      sendRadiusDisconnect.mockResolvedValue({ sent: true, response: 'Disconnect-ACK' });
      const result = await radiusService.disconnectSession(1);
      expect(result.sent).toBe(true);
      expect(sendRadiusDisconnect).toHaveBeenCalledWith(1);
    });
  });

  describe('changeOfAuth()', () => {
    test('delegates to suspensionService', async () => {
      sendRadiusCoA.mockResolvedValue({ sent: true, response: 'CoA-ACK' });
      const result = await radiusService.changeOfAuth(1, 'update');
      expect(result.sent).toBe(true);
      expect(sendRadiusCoA).toHaveBeenCalledWith(1, 'update');
    });
  });

  describe('getUsageSummary()', () => {
    test('returns aggregated usage data', async () => {
      db.query.mockResolvedValueOnce([[{
        session_count: 10,
        total_bytes_in: 10737418240,  // 10 GB
        total_bytes_out: 5368709120,   // 5 GB
        total_bytes: 16106127360,
        total_duration_seconds: 36000,
        total_packets_in: 1000000,
        total_packets_out: 500000,
      }]]);

      const result = await radiusService.getUsageSummary(1, { from: '2026-03-01', to: '2026-03-31' });
      expect(result.contract_id).toBe(1);
      expect(result.download_gb).toBe(10);
      expect(result.upload_gb).toBe(5);
      expect(result.sessions).toBe(10);
    });
  });
});
