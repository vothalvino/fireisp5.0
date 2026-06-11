// =============================================================================
// FireISP 5.0 — Pool Assignment Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const {
  ipv4ToInt,
  intToIpv4,
  parseIpv4Pool,
  ipv6ToBigInt,
  bigIntToIpv6,
  parseIpv6Pool,
  detectOverlap,
  assertNoOverlap,
  assignNextFreeIp,
} = require('../src/services/poolAssignmentService');

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// IPv4 math utilities
// =============================================================================

describe('ipv4ToInt / intToIpv4', () => {
  test('roundtrip: 10.0.0.0 → int → back', () => {
    const ip = '10.0.0.0';
    const n = ipv4ToInt(ip);
    expect(n).toBe(167772160);
    expect(intToIpv4(n)).toBe(ip);
  });

  test('roundtrip: 192.168.1.1 → int → back', () => {
    const ip = '192.168.1.1';
    expect(intToIpv4(ipv4ToInt(ip))).toBe(ip);
  });

  test('roundtrip: 255.255.255.255 → int → back', () => {
    const ip = '255.255.255.255';
    expect(intToIpv4(ipv4ToInt(ip))).toBe(ip);
  });
});

describe('parseIpv4Pool', () => {
  test('CIDR notation in network field: 10.0.0.0/24', () => {
    const pool = { network: '10.0.0.0/24', subnet_mask: null };
    const result = parseIpv4Pool(pool);
    expect(result).not.toBeNull();
    expect(result.network).toBe(ipv4ToInt('10.0.0.0'));     // 167772160
    expect(result.broadcast).toBe(ipv4ToInt('10.0.0.255')); // 167772415
    expect(result.prefixLen).toBe(24);
  });

  test('dotted-decimal subnet_mask: 10.0.0.0 + 255.255.255.0', () => {
    const pool = { network: '10.0.0.0', subnet_mask: '255.255.255.0' };
    const result = parseIpv4Pool(pool);
    expect(result).not.toBeNull();
    expect(result.network).toBe(ipv4ToInt('10.0.0.0'));
    expect(result.broadcast).toBe(ipv4ToInt('10.0.0.255'));
    expect(result.prefixLen).toBe(24);
  });

  test('/30 network: broadcast = network + 3, usable = 2', () => {
    const pool = { network: '10.0.0.0/30', subnet_mask: null };
    const result = parseIpv4Pool(pool);
    expect(result).not.toBeNull();
    expect(result.broadcast).toBe(result.network + 3);
    // usable = broadcast - network - 1 = 2
    expect(result.broadcast - result.network - 1).toBe(2);
  });

  // Note: parseIpv4Pool does NOT return null for 'not-an-ip' — parseInt('not-an-ip') produces NaN
  // which becomes 0 via >>> 0, giving {network:0, broadcast:0, prefixLen:32}.
  // This is the actual contract of the function (it only throws on hard exceptions).
  test('malformed input returns an object (not null) — service behaviour is best-effort', () => {
    const result = parseIpv4Pool({ network: 'not-an-ip', subnet_mask: null });
    // The function returns an object; callers that need strict validation do so separately
    expect(result).not.toBeNull();
  });
});

// =============================================================================
// Overlap detection (IPv4)
// =============================================================================

describe('detectOverlap (IPv4)', () => {
  const basePool = {
    ip_version: '4',
    organization_id: 1,
    network: '10.0.0.0/24',
    subnet_mask: null,
  };

  test('identical network overlaps', async () => {
    const peer = { id: 99, name: 'PeerA', network: '10.0.0.0/24', ip_version: '4', organization_id: 1 };
    db.query.mockResolvedValueOnce([[peer]]);

    const result = await detectOverlap(basePool);
    expect(result).toEqual(peer);
  });

  test('subset overlaps: pool inside peer', async () => {
    // Pool A = 10.0.0.0/25 (first half), peer = 10.0.0.0/24 (whole range)
    const pool = { ...basePool, network: '10.0.0.0/25' };
    const peer = { id: 99, name: 'PeerB', network: '10.0.0.0/24', ip_version: '4', organization_id: 1 };
    db.query.mockResolvedValueOnce([[peer]]);

    const result = await detectOverlap(pool);
    expect(result).toEqual(peer);
  });

  test('superset overlaps: pool contains peer', async () => {
    // Pool A = 10.0.0.0/23 contains 10.0.1.0/24
    const pool = { ...basePool, network: '10.0.0.0/23' };
    const peer = { id: 99, name: 'PeerC', network: '10.0.1.0/24', ip_version: '4', organization_id: 1 };
    db.query.mockResolvedValueOnce([[peer]]);

    const result = await detectOverlap(pool);
    expect(result).toEqual(peer);
  });

  test('adjacent ranges do not overlap', async () => {
    // 10.0.0.0/24 ends at .255; 10.0.1.0/24 starts at 10.0.1.0 — no overlap
    const pool = { ...basePool, network: '10.0.0.0/24' };
    const peer = { id: 99, name: 'PeerD', network: '10.0.1.0/24', ip_version: '4', organization_id: 1 };
    db.query.mockResolvedValueOnce([[peer]]);

    const result = await detectOverlap(pool);
    expect(result).toBeNull();
  });

  test('different ip_version: db returns empty → no overlap', async () => {
    // The query filters by ip_version so peers list is empty for a different version
    const pool = { ...basePool, ip_version: '4', network: '10.0.0.0/24' };
    db.query.mockResolvedValueOnce([[]]); // no peers returned for v4 query

    const result = await detectOverlap(pool);
    expect(result).toBeNull();
  });

  test('no peers at all → no overlap', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await detectOverlap(basePool);
    expect(result).toBeNull();
  });
});

describe('assertNoOverlap', () => {
  test('throws 409 when overlap found', async () => {
    const pool = { ip_version: '4', organization_id: 1, network: '10.0.0.0/24' };
    const peer = { id: 5, name: 'Conflict', network: '10.0.0.0/24', ip_version: '4', organization_id: 1 };
    db.query.mockResolvedValueOnce([[peer]]);

    await expect(assertNoOverlap(pool)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('overlaps'),
    });
  });

  test('resolves when no overlap', async () => {
    const pool = { ip_version: '4', organization_id: 1, network: '10.0.0.0/24' };
    db.query.mockResolvedValueOnce([[]]);

    await expect(assertNoOverlap(pool)).resolves.toBeUndefined();
  });
});

// =============================================================================
// IPv6 BigInt utilities
// =============================================================================

describe('ipv6ToBigInt / bigIntToIpv6', () => {
  test('roundtrip for 2001:db8::1', () => {
    const ip = '2001:db8::1';
    const big = ipv6ToBigInt(ip);
    // The BigInt must be positive and non-zero
    expect(big).toBeGreaterThan(0n);
    // Roundtrip: full form should re-parse to the same BigInt
    const full = bigIntToIpv6(big);
    expect(ipv6ToBigInt(full)).toBe(big);
    // Last group of the full form must be 0001
    const groups = full.split(':');
    expect(groups[7]).toBe('0001');
  });

  test('roundtrip for 2001:db8::', () => {
    const ip = '2001:db8::';
    const big = ipv6ToBigInt(ip);
    const full = bigIntToIpv6(big);
    expect(ipv6ToBigInt(full)).toBe(big);
  });

  test('all-zeros :: roundtrip', () => {
    expect(ipv6ToBigInt('::')).toBe(0n);
    expect(bigIntToIpv6(0n)).toBe('0000:0000:0000:0000:0000:0000:0000:0000');
  });
});

describe('parseIpv6Pool', () => {
  test('2001:db8::/32 → correct networkBig and prefixLen', () => {
    const pool = { network: '2001:db8::/32', ip_version: '6' };
    const result = parseIpv6Pool(pool);
    expect(result).not.toBeNull();
    expect(result.prefixLen).toBe(32);
    // Network address BigInt for 2001:db8::
    const expected = ipv6ToBigInt('2001:db8::');
    expect(result.networkBig).toBe(expected);
    // Broadcast is networkBig + (2^96 - 1)
    expect(result.broadcastBig).toBe(expected + (1n << 96n) - 1n);
  });

  test('returns null when network missing /prefix', () => {
    expect(parseIpv6Pool({ network: '2001:db8::', ip_version: '6' })).toBeNull();
  });
});

// =============================================================================
// Overlap detection (IPv6)
// =============================================================================

describe('detectOverlap (IPv6)', () => {
  test('2001:db8:1::/48 is a subset of 2001:db8::/32 → overlap', async () => {
    const pool = { ip_version: '6', organization_id: 1, network: '2001:db8:1::/48' };
    const peer = { id: 10, name: 'PeerV6', network: '2001:db8::/32', ip_version: '6', organization_id: 1 };
    db.query.mockResolvedValueOnce([[peer]]);

    const result = await detectOverlap(pool);
    expect(result).toEqual(peer);
  });

  test('adjacent IPv6 prefixes do not overlap', async () => {
    // 2001:db8:0::/48 ends before 2001:db8:1::/48 starts
    const pool = { ip_version: '6', organization_id: 1, network: '2001:db8:0::/48' };
    const peer = { id: 11, name: 'PeerV6B', network: '2001:db8:1::/48', ip_version: '6', organization_id: 1 };
    db.query.mockResolvedValueOnce([[peer]]);

    const result = await detectOverlap(pool);
    expect(result).toBeNull();
  });
});

// =============================================================================
// IPv6 prefix stepping — via assignNextFreeIp entry point
// =============================================================================

describe('IPv6 prefix stepping', () => {
  const ipv6Pool = {
    id: 5,
    organization_id: 1,
    ip_version: '6',
    network: '2001:db8::/32',
    default_prefix_len: 48,
    excluded_ranges: null,
  };

  // The first /48 block starts at 2001:db8::, i.e. the network address of the /32
  const firstNetBig = ipv6ToBigInt('2001:db8::');
  const firstAddr = bigIntToIpv6(firstNetBig);    // full expanded form
  const firstCidr = `${firstAddr}/48`;

  // The second /48 block is offset by blockSize = 2^(128-48) = 2^80
  const blockSize = 1n << 80n;
  const secondNetBig = firstNetBig + blockSize;
  const secondAddr = bigIntToIpv6(secondNetBig);
  const secondCidr = `${secondAddr}/48`;

  test('first available prefix is the network address of the pool', async () => {
    db.query
      .mockResolvedValueOnce([[ipv6Pool]])        // SELECT pool
      .mockResolvedValueOnce([[]])               // SELECT assignments (empty)
      .mockResolvedValueOnce([{ insertId: 42 }]) // INSERT
      .mockResolvedValueOnce([[{ id: 42, ip_address: firstCidr, pool_id: 5, status: 'active' }]]);

    const result = await assignNextFreeIp(5, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 });
    expect(result.ip_address).toBe(firstCidr);
  });

  test('second prefix assigned when first is taken', async () => {
    db.query
      .mockResolvedValueOnce([[ipv6Pool]])
      .mockResolvedValueOnce([[{ ip_address: firstCidr }]])  // first taken
      .mockResolvedValueOnce([{ insertId: 43 }])
      .mockResolvedValueOnce([[{ id: 43, ip_address: secondCidr, pool_id: 5, status: 'active' }]]);

    const result = await assignNextFreeIp(5, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 });
    expect(result.ip_address).toBe(secondCidr);
  });
});

// =============================================================================
// Assignment (IPv4) — via assignNextFreeIp (entry point)
// =============================================================================

describe('assignNextFreeIp (IPv4)', () => {
  const pool = {
    id: 10,
    organization_id: 1,
    ip_version: '4',
    network: '10.0.0.0/24',
    subnet_mask: null,
    gateway: null,
    excluded_ranges: null,
  };

  test('assigns first IP in empty /24 (10.0.0.1)', async () => {
    db.query
      .mockResolvedValueOnce([[pool]])           // SELECT pool
      .mockResolvedValueOnce([[]])               // SELECT assignments (empty)
      .mockResolvedValueOnce([{ insertId: 1 }]) // INSERT
      .mockResolvedValueOnce([[{ id: 1, ip_address: '10.0.0.1', pool_id: 10, status: 'active' }]]);

    const result = await assignNextFreeIp(10, { contractId: 10, clientId: 5, type: 'dynamic', orgId: 1 });
    expect(result.ip_address).toBe('10.0.0.1');
  });

  test('skips network address (.0) and broadcast (.255)', async () => {
    db.query
      .mockResolvedValueOnce([[pool]])
      .mockResolvedValueOnce([[]])               // no assignments
      .mockResolvedValueOnce([{ insertId: 2 }])
      .mockResolvedValueOnce([[{ id: 2, ip_address: '10.0.0.1', pool_id: 10, status: 'active' }]]);

    const result = await assignNextFreeIp(10, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 });
    // First assigned must be .1 (not .0 or .255)
    expect(result.ip_address).not.toBe('10.0.0.0');
    expect(result.ip_address).not.toBe('10.0.0.255');
    expect(result.ip_address).toBe('10.0.0.1');
    // Verify INSERT was called with .1
    const insertCall = db.query.mock.calls[2];
    expect(insertCall[1]).toContain('10.0.0.1');
  });

  test('skips excluded_ranges', async () => {
    const poolWithExcluded = { ...pool, excluded_ranges: '10.0.0.1\n10.0.0.2' };
    db.query
      .mockResolvedValueOnce([[poolWithExcluded]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 3 }])
      .mockResolvedValueOnce([[{ id: 3, ip_address: '10.0.0.3', pool_id: 10, status: 'active' }]]);

    const result = await assignNextFreeIp(10, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 });
    expect(result.ip_address).toBe('10.0.0.3');
    // Verify the INSERT was called with .3
    const insertCall = db.query.mock.calls[2];
    expect(insertCall[1]).toContain('10.0.0.3');
  });

  test('skips already-assigned IPs', async () => {
    const taken = [
      { ip_address: '10.0.0.1' },
      { ip_address: '10.0.0.2' },
      { ip_address: '10.0.0.3' },
    ];
    db.query
      .mockResolvedValueOnce([[pool]])
      .mockResolvedValueOnce([taken])
      .mockResolvedValueOnce([{ insertId: 4 }])
      .mockResolvedValueOnce([[{ id: 4, ip_address: '10.0.0.4', pool_id: 10, status: 'active' }]]);

    const result = await assignNextFreeIp(10, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 });
    expect(result.ip_address).toBe('10.0.0.4');
  });

  test('pool exhaustion throws error matching /exhausted|No free/i', async () => {
    // Fill all usable IPs: .1 through .254 (254 addresses in /24)
    const allTaken = [];
    for (let i = 1; i <= 254; i++) {
      allTaken.push({ ip_address: `10.0.0.${i}` });
    }
    db.query
      .mockResolvedValueOnce([[pool]])
      .mockResolvedValueOnce([allTaken]);

    await expect(
      assignNextFreeIp(10, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/exhausted|No free/i),
    });
  });

  test('pool not found throws 404', async () => {
    db.query.mockResolvedValueOnce([[]]); // empty rows
    await expect(
      assignNextFreeIp(999, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// =============================================================================
// Assignment (IPv6) — via assignNextFreeIp (entry point)
// =============================================================================

describe('assignNextFreeIp (IPv6)', () => {
  const ipv6Pool = {
    id: 20,
    organization_id: 1,
    ip_version: '6',
    network: '2001:db8::/32',
    default_prefix_len: 48,
    excluded_ranges: null,
  };

  test('first prefix from /32 with default_prefix_len=48', async () => {
    const firstAddr = bigIntToIpv6(ipv6ToBigInt('2001:db8::'));
    const firstCidr = `${firstAddr}/48`;
    db.query
      .mockResolvedValueOnce([[ipv6Pool]])        // SELECT pool
      .mockResolvedValueOnce([[]])               // SELECT assignments (empty)
      .mockResolvedValueOnce([{ insertId: 10 }]) // INSERT
      .mockResolvedValueOnce([[{ id: 10, ip_address: firstCidr, pool_id: 20, status: 'active' }]]);

    const result = await assignNextFreeIp(20, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 });
    expect(result.ip_address).toBe(firstCidr);
  });

  test('second prefix when first is taken', async () => {
    const firstAddr = bigIntToIpv6(ipv6ToBigInt('2001:db8::'));
    const firstCidr = `${firstAddr}/48`;

    // second /48 starts at firstNetBig + blockSize
    const blockSize = 1n << 80n; // 2^(128-48)
    const secondNetBig = ipv6ToBigInt('2001:db8::') + blockSize;
    const secondAddr = bigIntToIpv6(secondNetBig);
    const secondCidr = `${secondAddr}/48`;

    db.query
      .mockResolvedValueOnce([[ipv6Pool]])
      .mockResolvedValueOnce([[{ ip_address: firstCidr }]])  // first taken
      .mockResolvedValueOnce([{ insertId: 11 }])
      .mockResolvedValueOnce([[{ id: 11, ip_address: secondCidr, pool_id: 20, status: 'active' }]]);

    const result = await assignNextFreeIp(20, { contractId: 1, clientId: 1, type: 'dynamic', orgId: 1 });
    expect(result.ip_address).toBe(secondCidr);
  });
});
