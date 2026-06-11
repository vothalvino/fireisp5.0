// =============================================================================
// FireISP 5.0 — Speed Window Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/radiusService', () => ({
  changeOfAuth: jest.fn(),
}));

const db = require('../src/config/database');
const radiusService = require('../src/services/radiusService');
const { getActiveWindow, applySpeedWindows } = require('../src/services/speedWindowService');

describe('speedWindowService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getActiveWindow()', () => {
    it('returns window when one matches current time and day', async () => {
      const mockWindow = { id: 1, plan_id: 5, label: 'Night Unlimited', download_speed_mbps: 1000, upload_speed_mbps: 100 };
      db.query.mockResolvedValueOnce([[mockWindow]]);

      const result = await getActiveWindow(5);
      expect(result).toEqual(mockWindow);
    });

    it('returns null when no window matches', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await getActiveWindow(5);
      expect(result).toBeNull();
    });
  });

  describe('applySpeedWindows()', () => {
    it('applies CoA for contracts with active windows', async () => {
      // contracts query
      db.query.mockResolvedValueOnce([[
        { contract_id: 10, plan_id: 5 },
        { contract_id: 11, plan_id: 5 },
      ]]);
      // getActiveWindow for contract 10 plan 5
      db.query.mockResolvedValueOnce([[{ id: 1, label: 'Night' }]]);
      // getActiveWindow for contract 11 plan 5 (no window)
      db.query.mockResolvedValueOnce([[]]);
      radiusService.changeOfAuth.mockResolvedValue({ success: true });

      const result = await applySpeedWindows(1);

      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(0);
      expect(radiusService.changeOfAuth).toHaveBeenCalledTimes(1);
    });

    it('increments errors when CoA throws', async () => {
      db.query.mockResolvedValueOnce([[{ contract_id: 10, plan_id: 5 }]]);
      db.query.mockResolvedValueOnce([[{ id: 1, label: 'Night' }]]);
      radiusService.changeOfAuth.mockRejectedValueOnce(new Error('Network error'));

      const result = await applySpeedWindows(1);
      expect(result.errors).toBe(1);
      expect(result.applied).toBe(0);
    });
  });
});
