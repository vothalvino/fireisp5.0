// =============================================================================
// FireISP 5.0 — IP Allowlist Middleware Tests
// =============================================================================

const {
  ipv4ToInt,
  normalizeIp,
  parseEntry,
  parseAllowlist,
  isAllowed,
  createIpAllowlist,
} = require('../src/middleware/ipAllowlist');

// ---------------------------------------------------------------------------
// ipv4ToInt
// ---------------------------------------------------------------------------
describe('ipv4ToInt', () => {
  test('converts well-known addresses', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(0xffffffff);
    expect(ipv4ToInt('127.0.0.1')).toBe(0x7f000001);
    expect(ipv4ToInt('10.0.0.1')).toBe(0x0a000001);
    expect(ipv4ToInt('192.168.1.100')).toBe(0xc0a80164);
  });

  test('returns null for invalid input', () => {
    expect(ipv4ToInt('')).toBeNull();
    expect(ipv4ToInt('not-an-ip')).toBeNull();
    expect(ipv4ToInt('256.0.0.1')).toBeNull();
    expect(ipv4ToInt('192.168.1')).toBeNull();
    expect(ipv4ToInt('192.168.1.1.1')).toBeNull();
    expect(ipv4ToInt('192.168.1.-1')).toBeNull();
    expect(ipv4ToInt(null)).toBeNull();
    expect(ipv4ToInt(undefined)).toBeNull();
    expect(ipv4ToInt(123)).toBeNull();
  });

  test('does not accept octal-style parts', () => {
    // "010" would be 10 in decimal — we require String(n) === part
    expect(ipv4ToInt('010.0.0.1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeIp
// ---------------------------------------------------------------------------
describe('normalizeIp', () => {
  test('returns plain IPv4 unchanged', () => {
    expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
    expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1');
  });

  test('strips IPv6 zone IDs', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp('::1%lo')).toBe('::1');
  });

  test('converts IPv4-mapped IPv6 dotted form', () => {
    expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp('::FFFF:203.0.113.5')).toBe('203.0.113.5');
  });

  test('converts IPv4-mapped IPv6 hex form', () => {
    // ::ffff:c0a8:0101 = 192.168.1.1
    expect(normalizeIp('::ffff:c0a8:0101')).toBe('192.168.1.1');
    // ::ffff:7f00:0001 = 127.0.0.1
    expect(normalizeIp('::ffff:7f00:0001')).toBe('127.0.0.1');
  });

  test('returns null for empty/invalid input', () => {
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });

  test('passes through non-IPv4-mapped IPv6 addresses unchanged', () => {
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });
});

// ---------------------------------------------------------------------------
// parseEntry
// ---------------------------------------------------------------------------
describe('parseEntry', () => {
  test('parses plain IPv4 host entry', () => {
    const entry = parseEntry('192.168.1.1');
    expect(entry).not.toBeNull();
    expect(entry.network).toBe(ipv4ToInt('192.168.1.1'));
    expect(entry.mask).toBe(0xffffffff);
  });

  test('parses /32 CIDR (single host)', () => {
    const entry = parseEntry('10.0.0.5/32');
    expect(entry).not.toBeNull();
    expect(entry.network).toBe(ipv4ToInt('10.0.0.5'));
    expect(entry.mask).toBe(0xffffffff);
  });

  test('parses /24 CIDR', () => {
    const entry = parseEntry('192.168.1.0/24');
    expect(entry).not.toBeNull();
    expect(entry.mask).toBe(0xffffff00);
    expect(entry.network).toBe(ipv4ToInt('192.168.1.0'));
  });

  test('parses /16 CIDR', () => {
    const entry = parseEntry('10.10.0.0/16');
    expect(entry).not.toBeNull();
    expect(entry.mask).toBe(0xffff0000);
    expect(entry.network).toBe(ipv4ToInt('10.10.0.0'));
  });

  test('parses /8 CIDR', () => {
    const entry = parseEntry('10.0.0.0/8');
    expect(entry).not.toBeNull();
    expect(entry.mask).toBe(0xff000000);
    expect(entry.network).toBe(ipv4ToInt('10.0.0.0'));
  });

  test('parses /0 CIDR (match all)', () => {
    const entry = parseEntry('0.0.0.0/0');
    expect(entry).not.toBeNull();
    expect(entry.mask).toBe(0);
    expect(entry.network).toBe(0);
  });

  test('trims surrounding whitespace', () => {
    expect(parseEntry('  10.0.0.1  ')).not.toBeNull();
    expect(parseEntry('  10.0.0.0/8  ')).not.toBeNull();
  });

  test('returns null for invalid entries', () => {
    expect(parseEntry('')).toBeNull();
    expect(parseEntry(null)).toBeNull();
    expect(parseEntry(undefined)).toBeNull();
    expect(parseEntry('not-an-ip')).toBeNull();
    expect(parseEntry('256.0.0.1')).toBeNull();
    expect(parseEntry('10.0.0.0/33')).toBeNull();
    expect(parseEntry('10.0.0.0/-1')).toBeNull();
    expect(parseEntry('10.0.0.0/abc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAllowlist
// ---------------------------------------------------------------------------
describe('parseAllowlist', () => {
  test('returns null when input is empty or not set', () => {
    expect(parseAllowlist('')).toBeNull();
    expect(parseAllowlist(null)).toBeNull();
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist('  ')).toBeNull();
  });

  test('parses a single IP', () => {
    const list = parseAllowlist('10.0.0.1');
    expect(list).toHaveLength(1);
    expect(list[0].network).toBe(ipv4ToInt('10.0.0.1'));
  });

  test('parses multiple IPs and CIDRs', () => {
    const list = parseAllowlist('10.0.0.1,192.168.0.0/24,172.16.0.0/12');
    expect(list).toHaveLength(3);
  });

  test('skips invalid entries but keeps valid ones', () => {
    const list = parseAllowlist('10.0.0.1,not-valid,192.168.1.0/24');
    expect(list).toHaveLength(2);
  });

  test('returns null when all entries are invalid', () => {
    expect(parseAllowlist('not-valid,also-invalid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isAllowed
// ---------------------------------------------------------------------------
describe('isAllowed', () => {
  test('allows all IPs when allowlist is null (feature disabled)', () => {
    expect(isAllowed('1.2.3.4', null)).toBe(true);
    expect(isAllowed('8.8.8.8', null)).toBe(true);
    expect(isAllowed('', null)).toBe(true);
  });

  test('allows an IP that exactly matches an allowlist entry', () => {
    const list = parseAllowlist('203.0.113.5');
    expect(isAllowed('203.0.113.5', list)).toBe(true);
  });

  test('blocks an IP not in the allowlist', () => {
    const list = parseAllowlist('203.0.113.5');
    expect(isAllowed('203.0.113.6', list)).toBe(false);
    expect(isAllowed('8.8.8.8', list)).toBe(false);
  });

  test('allows an IP inside a CIDR range', () => {
    const list = parseAllowlist('10.0.0.0/8');
    expect(isAllowed('10.255.255.255', list)).toBe(true);
    expect(isAllowed('10.0.0.1', list)).toBe(true);
    expect(isAllowed('10.128.64.32', list)).toBe(true);
  });

  test('blocks an IP outside a CIDR range', () => {
    const list = parseAllowlist('10.0.0.0/8');
    expect(isAllowed('11.0.0.1', list)).toBe(false);
    expect(isAllowed('192.168.1.1', list)).toBe(false);
  });

  test('allows an IP inside a /24', () => {
    const list = parseAllowlist('192.168.1.0/24');
    expect(isAllowed('192.168.1.0', list)).toBe(true);
    expect(isAllowed('192.168.1.254', list)).toBe(true);
    expect(isAllowed('192.168.2.1', list)).toBe(false);
  });

  test('matches when multiple entries are present', () => {
    const list = parseAllowlist('10.0.0.0/8,203.0.113.5');
    expect(isAllowed('10.1.2.3', list)).toBe(true);
    expect(isAllowed('203.0.113.5', list)).toBe(true);
    expect(isAllowed('8.8.8.8', list)).toBe(false);
  });

  test('handles IPv4-mapped IPv6 addresses', () => {
    const list = parseAllowlist('192.168.1.1');
    expect(isAllowed('::ffff:192.168.1.1', list)).toBe(true);
    expect(isAllowed('::ffff:192.168.1.2', list)).toBe(false);
  });

  test('returns false for blank or non-IPv4 addresses when allowlist is active', () => {
    const list = parseAllowlist('10.0.0.0/8');
    expect(isAllowed('', list)).toBe(false);
    expect(isAllowed('::1', list)).toBe(false);
    expect(isAllowed(null, list)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createIpAllowlist (middleware)
// ---------------------------------------------------------------------------
describe('createIpAllowlist', () => {
  function mockReq(ip) {
    return { ip, socket: { remoteAddress: ip } };
  }

  test('when allowlist is null, always calls next() without error', () => {
    const mw = createIpAllowlist(null);
    const next = jest.fn();
    mw(mockReq('8.8.8.8'), {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('when allowlist is null, no-op function name is ipAllowlistDisabled', () => {
    const mw = createIpAllowlist(null);
    expect(mw.name).toBe('ipAllowlistDisabled');
  });

  test('allows an allowlisted IP and calls next()', () => {
    const mw = createIpAllowlist(parseAllowlist('10.0.0.0/8'));
    const next = jest.fn();
    mw(mockReq('10.20.30.40'), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('blocks a non-allowlisted IP and calls next(error)', () => {
    const mw = createIpAllowlist(parseAllowlist('10.0.0.0/8'));
    const next = jest.fn();
    mw(mockReq('8.8.8.8'), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FORBIDDEN',
    }));
  });

  test('blocks when req.ip is empty', () => {
    const mw = createIpAllowlist(parseAllowlist('10.0.0.0/8'));
    const next = jest.fn();
    mw({ ip: '', socket: {} }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  test('allows IPv4-mapped IPv6 that maps to an allowlisted IPv4', () => {
    const mw = createIpAllowlist(parseAllowlist('192.168.1.0/24'));
    const next = jest.fn();
    mw(mockReq('::ffff:192.168.1.42'), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('uses socket.remoteAddress when req.ip is missing', () => {
    const mw = createIpAllowlist(parseAllowlist('10.0.0.1'));
    const next = jest.fn();
    const req = { socket: { remoteAddress: '10.0.0.1' } };
    mw(req, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('allows multiple entries — first match wins', () => {
    const mw = createIpAllowlist(parseAllowlist('10.0.0.0/8,203.0.113.5'));
    const nextA = jest.fn();
    const nextB = jest.fn();
    const nextC = jest.fn();
    mw(mockReq('10.1.2.3'), {}, nextA);
    mw(mockReq('203.0.113.5'), {}, nextB);
    mw(mockReq('1.1.1.1'), {}, nextC);
    expect(nextA).toHaveBeenCalledWith();
    expect(nextB).toHaveBeenCalledWith();
    expect(nextC).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
