// =============================================================================
// FireISP 5.0 — Billing Overage & Trial Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn(), getConnection: jest.fn() }));

const db = require('../src/config/database');
const { calculateOverageCharges, isContractInTrial } = require('../src/services/billingService');

describe('billingService — overage charges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns zero when overage_mode is none', async () => {
    db.query.mockResolvedValueOnce([[{
      data_cap_gb: 100,
      overage_mode: 'none',
      overage_price_per_gb: null,
      bytes_used: 200 * 1073741824,
    }]]);

    const result = await calculateOverageCharges(1, '2025-01-01', '2025-01-31');
    expect(result.overage_gb).toBe(0);
    expect(result.amount).toBe(0);
  });

  it('returns zero when usage is under cap', async () => {
    db.query.mockResolvedValueOnce([[{
      data_cap_gb: 100,
      overage_mode: 'per_gb',
      overage_price_per_gb: '0.50',
      bytes_used: 50 * 1073741824,
    }]]);

    const result = await calculateOverageCharges(1, '2025-01-01', '2025-01-31');
    expect(result.overage_gb).toBe(0);
    expect(result.amount).toBe(0);
  });

  it('calculates correct amount for per_gb overage mode', async () => {
    db.query.mockResolvedValueOnce([[{
      data_cap_gb: 100,
      overage_mode: 'per_gb',
      overage_price_per_gb: '0.50',
      bytes_used: 110 * 1073741824,
    }]]);

    const result = await calculateOverageCharges(1, '2025-01-01', '2025-01-31');
    expect(result.overage_gb).toBeCloseTo(10, 0);
    expect(result.amount).toBeCloseTo(5.0, 1);
  });

  it('returns zero when contract not found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await calculateOverageCharges(999, '2025-01-01', '2025-01-31');
    expect(result.overage_gb).toBe(0);
    expect(result.amount).toBe(0);
  });
});

describe('billingService — trial detection', () => {
  it('returns false when plan has no trial_days', () => {
    const contract = { start_date: '2025-01-01' };
    const plan = { trial_days: null };
    expect(isContractInTrial(contract, plan)).toBe(false);
  });

  it('returns false when trial_days is 0', () => {
    const contract = { start_date: '2025-01-01' };
    const plan = { trial_days: 0 };
    expect(isContractInTrial(contract, plan)).toBe(false);
  });

  it('returns true when within trial period', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const contract = { start_date: yesterday.toISOString().slice(0, 10) };
    const plan = { trial_days: 30 };
    expect(isContractInTrial(contract, plan)).toBe(true);
  });

  it('returns false when trial period has expired', () => {
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 60);
    const contract = { start_date: longAgo.toISOString().slice(0, 10) };
    const plan = { trial_days: 30 };
    expect(isContractInTrial(contract, plan)).toBe(false);
  });
});
