// =============================================================================
// FireISP 5.0 — userTunnelScopeService tests (§9 Part 2)
// =============================================================================
// Covers getScopedSubnets():
//   - admin/owner → all live routed_subnets in the org (via nas_wg_tunnels)
//   - technician  → only subnets reachable through user_network_assignments
//   - support     → same as technician
//   - unassigned  → [] (valid peer that reaches nothing)
//   - JSON flatten + dedupe + sort
// =============================================================================

// Mock DB before any requires so the module cache sees the mock
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// Mock the User model so getOrgRole is controllable without a real DB
jest.mock('../src/models/User', () => ({
  getOrgRole: jest.fn(),
}));

// Mock logger to suppress noise
jest.mock('../src/utils/logger', () => ({
  child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

const db = require('../src/config/database');
const User = require('../src/models/User');
const { getScopedSubnets } = require('../src/services/userTunnelScopeService');

// ---------------------------------------------------------------------------
// Constants shared across tests
// ---------------------------------------------------------------------------
const ORG_ID  = 1;
const USER_ID = 42;

// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// Admin path — legacyRole 'admin'
// ===========================================================================
describe('getScopedSubnets() — admin (legacyRole)', () => {
  test('returns all active routed_subnets for the org when legacyRole is admin', async () => {
    // getOrgRole resolves to null (not an org-member, but legacyRole = 'admin')
    User.getOrgRole.mockResolvedValue(null);

    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['192.168.1.0/24', '10.0.0.0/8']) },
      { routed_subnets: JSON.stringify(['172.16.0.0/12']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual(['10.0.0.0/8', '172.16.0.0/12', '192.168.1.0/24']); // sorted
    // Must query nas_wg_tunnels, not user_network_assignments
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('nas_wg_tunnels'),
      [ORG_ID],
    );
  });

  test('returns [] when no active tunnels exist for the org', async () => {
    User.getOrgRole.mockResolvedValue(null);
    db.query.mockResolvedValueOnce([[]]); // no rows

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('handles tunnels whose routed_subnets column is null', async () => {
    User.getOrgRole.mockResolvedValue(null);
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['10.1.0.0/24']) },
      { routed_subnets: null },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual(['10.1.0.0/24']); // null row silently dropped
  });
});

// ===========================================================================
// Admin path — orgRole 'owner' or 'admin' (from organization_users)
// ===========================================================================
describe('getScopedSubnets() — admin (org role)', () => {
  test('treats orgRole=owner as admin regardless of legacyRole', async () => {
    User.getOrgRole.mockResolvedValue('owner');
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['10.20.0.0/16']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'technician');

    expect(result).toEqual(['10.20.0.0/16']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('nas_wg_tunnels'),
      [ORG_ID],
    );
  });

  test('treats orgRole=admin as admin regardless of legacyRole', async () => {
    User.getOrgRole.mockResolvedValue('admin');
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['10.30.0.0/24']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'support');

    expect(result).toEqual(['10.30.0.0/24']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('nas_wg_tunnels'),
      [ORG_ID],
    );
  });
});

// ===========================================================================
// Technician path
// ===========================================================================
describe('getScopedSubnets() — technician (non-admin)', () => {
  test('returns only subnets reachable via assigned NAS/site', async () => {
    User.getOrgRole.mockResolvedValue('technician');
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['192.168.10.0/24', '192.168.11.0/24']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'technician');

    expect(result).toEqual(['192.168.10.0/24', '192.168.11.0/24']);
    // Must query user_network_assignments, not nas_wg_tunnels directly
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('user_network_assignments'),
      [USER_ID],
    );
  });

  test('returns [] when technician has no assignments', async () => {
    User.getOrgRole.mockResolvedValue('technician');
    db.query.mockResolvedValueOnce([[]]); // no rows from the JOIN

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'technician');

    expect(result).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('deduplicates subnets that appear in multiple assigned NASes', async () => {
    User.getOrgRole.mockResolvedValue('technician');
    // Two rows each contain overlapping CIDRs
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['10.5.0.0/24', '10.6.0.0/24']) },
      { routed_subnets: JSON.stringify(['10.6.0.0/24', '10.7.0.0/24']) }, // 10.6 duplicated
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'technician');

    expect(result).toEqual(['10.5.0.0/24', '10.6.0.0/24', '10.7.0.0/24']); // no dup
    expect(result).toHaveLength(3);
  });

  test('also includes subnets from site-grain assignments (same JOIN path)', async () => {
    User.getOrgRole.mockResolvedValue('technician');
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['172.16.5.0/24']) },
      { routed_subnets: JSON.stringify(['172.16.6.0/24']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'technician');

    expect(result).toEqual(['172.16.5.0/24', '172.16.6.0/24']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('scope_type'),
      [USER_ID],
    );
  });
});

// ===========================================================================
// Support path — same code branch as technician
// ===========================================================================
describe('getScopedSubnets() — support (non-admin)', () => {
  test('support with assignments receives only assigned subnets', async () => {
    User.getOrgRole.mockResolvedValue('support');
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['10.0.100.0/24']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'support');

    expect(result).toEqual(['10.0.100.0/24']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('user_network_assignments'),
      [USER_ID],
    );
  });

  test('support with no assignments returns []', async () => {
    User.getOrgRole.mockResolvedValue('support');
    db.query.mockResolvedValueOnce([[]]); // empty JOIN

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'support');

    expect(result).toEqual([]);
  });
});

// ===========================================================================
// JSON parsing — both pre-parsed array and raw string from mysql2
// ===========================================================================
describe('getScopedSubnets() — routed_subnets JSON handling', () => {
  test('accepts pre-parsed JS array (mysql2 JSON column)', async () => {
    User.getOrgRole.mockResolvedValue(null);
    db.query.mockResolvedValueOnce([[
      { routed_subnets: ['10.50.0.0/24', '10.51.0.0/24'] }, // already an array
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual(['10.50.0.0/24', '10.51.0.0/24']);
  });

  test('accepts JSON string (mysql2 without JSON type hint)', async () => {
    User.getOrgRole.mockResolvedValue(null);
    db.query.mockResolvedValueOnce([[
      { routed_subnets: '["10.60.0.0/24","10.61.0.0/24"]' },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual(['10.60.0.0/24', '10.61.0.0/24']);
  });

  test('silently ignores malformed JSON rows', async () => {
    User.getOrgRole.mockResolvedValue(null);
    db.query.mockResolvedValueOnce([[
      { routed_subnets: 'not-valid-json' },
      { routed_subnets: JSON.stringify(['10.70.0.0/24']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual(['10.70.0.0/24']); // only valid row contributed
  });

  test('result is always alphabetically sorted', async () => {
    User.getOrgRole.mockResolvedValue(null);
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
  });
});

// ===========================================================================
// Resilience — getOrgRole failure falls back to legacyRole
// ===========================================================================
describe('getScopedSubnets() — getOrgRole failure fallback', () => {
  test('falls back to legacyRole=admin when getOrgRole rejects', async () => {
    User.getOrgRole.mockRejectedValue(new Error('DB timeout'));
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['10.88.0.0/24']) },
    ]]);

    // legacyRole='admin' should still yield admin path despite getOrgRole error
    const result = await getScopedSubnets(USER_ID, ORG_ID, 'admin');

    expect(result).toEqual(['10.88.0.0/24']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('nas_wg_tunnels'),
      [ORG_ID],
    );
  });

  test('falls back to non-admin path when getOrgRole rejects and legacyRole is technician', async () => {
    User.getOrgRole.mockRejectedValue(new Error('DB timeout'));
    db.query.mockResolvedValueOnce([[
      { routed_subnets: JSON.stringify(['10.99.0.0/24']) },
    ]]);

    const result = await getScopedSubnets(USER_ID, ORG_ID, 'technician');

    expect(result).toEqual(['10.99.0.0/24']);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('user_network_assignments'),
      [USER_ID],
    );
  });
});
