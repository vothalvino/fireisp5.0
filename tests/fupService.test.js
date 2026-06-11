// =============================================================================
// FireISP 5.0 — FUP Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/radiusService', () => ({
  changeOfAuth: jest.fn(),
}));

const db = require('../src/config/database');
const radiusService = require('../src/services/radiusService');
const { applyFupThrottle, restoreFupSpeeds } = require('../src/services/fupService');

describe('fupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('applyFupThrottle()', () => {
    it('sends CoA and logs throttle when contract found', async () => {
      db.query
        .mockResolvedValueOnce([[{ contract_id: 1, organization_id: 10, fup_download_speed_mbps: 5, fup_upload_speed_mbps: 1 }]])
        .mockResolvedValueOnce([{ insertId: 42 }]);
      radiusService.changeOfAuth.mockResolvedValueOnce({ success: true });

      const result = await applyFupThrottle(1);

      expect(result.applied).toBe(true);
      expect(result.coa_sent).toBe(true);
      expect(result.log_id).toBe(42);
      expect(radiusService.changeOfAuth).toHaveBeenCalledWith(1, 'throttle');
    });

    it('logs throttle even when CoA fails', async () => {
      db.query
        .mockResolvedValueOnce([[{ contract_id: 1, organization_id: 10, fup_download_speed_mbps: 5, fup_upload_speed_mbps: 1 }]])
        .mockResolvedValueOnce([{ insertId: 43 }]);
      radiusService.changeOfAuth.mockRejectedValueOnce(new Error('CoA timeout'));

      const result = await applyFupThrottle(1);

      expect(result.applied).toBe(true);
      expect(result.coa_sent).toBe(false);
      expect(result.log_id).toBe(43);
    });

    it('returns not applied when contract not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await applyFupThrottle(999);
      expect(result.applied).toBe(false);
    });
  });

  describe('restoreFupSpeeds()', () => {
    it('sends CoA and logs restore when contract found', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 10 }]])
        .mockResolvedValueOnce([{ insertId: 50 }]);
      radiusService.changeOfAuth.mockResolvedValueOnce({ success: true });

      const result = await restoreFupSpeeds(1);

      expect(result.restored).toBe(true);
      expect(result.coa_sent).toBe(true);
      expect(result.log_id).toBe(50);
      expect(radiusService.changeOfAuth).toHaveBeenCalledWith(1, 'restore');
    });

    it('logs restore even when CoA fails', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 10 }]])
        .mockResolvedValueOnce([{ insertId: 51 }]);
      radiusService.changeOfAuth.mockRejectedValueOnce(new Error('CoA timeout'));

      const result = await restoreFupSpeeds(1);

      expect(result.restored).toBe(true);
      expect(result.coa_sent).toBe(false);
    });

    it('returns not restored when contract not found', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await restoreFupSpeeds(999);
      expect(result.restored).toBe(false);
    });
  });
});
