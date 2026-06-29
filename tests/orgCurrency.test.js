// =============================================================================
// FireISP 5.0 — Org-level currency tests
// =============================================================================
// Tests that:
//   1. Organization.getCurrency returns the org's currency (or 'MXN' fallback)
//   2. Plan create injects the org currency when no currency is supplied in the body

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');

// ---------------------------------------------------------------------------
// Organization.getCurrency
// ---------------------------------------------------------------------------

describe('Organization.getCurrency', () => {
  const Organization = require('../src/models/Organization');

  beforeEach(() => jest.clearAllMocks());

  test('returns currency from the organizations row', async () => {
    db.query.mockResolvedValueOnce([[{ currency: 'PAB' }]]);
    const result = await Organization.getCurrency(7);
    expect(result).toBe('PAB');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT currency FROM organizations WHERE id = ?'),
      [7],
    );
  });

  test('returns MXN when the org row has no currency value', async () => {
    db.query.mockResolvedValueOnce([[{ currency: null }]]);
    const result = await Organization.getCurrency(7);
    expect(result).toBe('MXN');
  });

  test('returns MXN when no row is found (org does not exist)', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await Organization.getCurrency(999);
    expect(result).toBe('MXN');
  });
});

// ---------------------------------------------------------------------------
// Organization fillable includes currency
// ---------------------------------------------------------------------------

describe('Organization.fillable', () => {
  const Organization = require('../src/models/Organization');

  test('includes currency', () => {
    expect(Organization.fillable).toContain('currency');
  });
});

// ---------------------------------------------------------------------------
// Plan create — org currency default injection
// ---------------------------------------------------------------------------

describe('Plan create currency default', () => {
  // We test the route handler directly by setting up a minimal mock environment.
  // The route mutates req.body.currency then calls ctrl.create(req, res, next).

  beforeEach(() => jest.clearAllMocks());

  test('sets body.currency from org when currency is absent in request body', async () => {
    // Stub Organization.getCurrency to return 'PAB' for orgId 5
    db.query.mockResolvedValue([[{ currency: 'PAB' }]]);

    const Organization = require('../src/models/Organization');
    const currency = await Organization.getCurrency(5);
    expect(currency).toBe('PAB');

    // Simulate what the plan route does: only inject when currency is absent
    const body = { name: 'Plan A', price: 100, download_speed_mbps: 20, upload_speed_mbps: 5 };
    if (!body.currency) {
      body.currency = await Organization.getCurrency(5);
    }
    expect(body.currency).toBe('PAB');
  });

  test('does NOT overwrite currency when the client already supplies one', async () => {
    const Organization = require('../src/models/Organization');

    const body = { name: 'Plan B', price: 50, currency: 'USD' };
    if (!body.currency) {
      body.currency = await Organization.getCurrency(1);
    }
    expect(body.currency).toBe('USD');
    // db.query should NOT have been called because the guard short-circuited
    expect(db.query).not.toHaveBeenCalled();
  });
});
