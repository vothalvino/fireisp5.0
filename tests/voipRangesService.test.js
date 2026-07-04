// =============================================================================
// FireISP 5.0 — VoIP Ranges Service Tests
// =============================================================================
// Covers CIDR validation, source-body parsing (JSON + plain), range resolution
// (fetch, dedupe, validate, cap, fallback) and the refreshAllNas fan-out. Config,
// DB and the RouterOS push are mocked — no network / device I/O.
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../src/config', () => ({
  voipRanges: { enabled: true, sourceUrls: ['https://example.com/zoom.txt'], maxEntries: 4000, fetchTimeoutMs: 1000 },
}));
jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/routerProvisioningService');

const config = require('../src/config');
const db = require('../src/config/database');
const routerProvisioningService = require('../src/services/routerProvisioningService');
const svc = require('../src/services/voipRangesService');

// A fetch stub returning a fixed body per URL (or throwing to simulate a failure).
function makeFetch(bodyByUrl) {
  return jest.fn(async (url) => {
    const entry = bodyByUrl[url];
    if (entry instanceof Error) throw entry;
    return { ok: true, text: async () => entry };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  config.voipRanges.enabled = true;
  config.voipRanges.sourceUrls = ['https://example.com/zoom.txt'];
  config.voipRanges.maxEntries = 4000;
});

// =============================================================================
// isIpv4Cidr
// =============================================================================
describe('isIpv4Cidr', () => {
  test.each([
    ['8.8.8.0/24', true],
    ['1.2.3.4', true],
    ['0.0.0.0/0', true],
    ['255.255.255.255/32', true],
    ['256.1.1.1', false],
    ['1.2.3.4/33', false],
    ['1.2.3', false],
    ['2001:db8::/32', false],
    ['not-an-ip', false],
    ['', false],
  ])('%s → %s', (input, expected) => {
    expect(svc.isIpv4Cidr(input)).toBe(expected);
  });
});

// =============================================================================
// parseSourceBody
// =============================================================================
describe('parseSourceBody', () => {
  test('parses Google-style JSON, taking only ipv4Prefix', () => {
    const body = JSON.stringify({ prefixes: [
      { ipv4Prefix: '8.8.8.0/24' },
      { ipv6Prefix: '2001:db8::/32' },
      { ipv4Prefix: '1.1.1.0/24' },
    ] });
    expect(svc.parseSourceBody(body)).toEqual(['8.8.8.0/24', '1.1.1.0/24']);
  });

  test('parses AWS-style ip_prefix and bare-string arrays', () => {
    expect(svc.parseSourceBody(JSON.stringify([{ ip_prefix: '3.4.5.0/24' }, '9.9.9.0/24']))).toEqual(['3.4.5.0/24', '9.9.9.0/24']);
  });

  test('parses plain CIDR lines, skipping blanks and comments', () => {
    const body = '8.8.8.0/24\n# a comment\n\n  1.1.1.0/24  \n; another\n';
    expect(svc.parseSourceBody(body)).toEqual(['8.8.8.0/24', '1.1.1.0/24']);
  });

  test('returns [] for empty/non-string input', () => {
    expect(svc.parseSourceBody('')).toEqual([]);
    expect(svc.parseSourceBody(null)).toEqual([]);
  });
});

// =============================================================================
// resolveRanges
// =============================================================================
describe('resolveRanges', () => {
  test('fetches, validates and de-duplicates across sources', async () => {
    config.voipRanges.sourceUrls = ['https://a/list', 'https://b/list'];
    const fetchImpl = makeFetch({
      'https://a/list': '8.8.8.0/24\n1.1.1.0/24\nbogus/99',
      'https://b/list': '1.1.1.0/24\n9.9.9.0/24', // 1.1.1.0/24 dup
    });

    const { ranges, sources, capped } = await svc.resolveRanges({ fetchImpl });

    expect(new Set(ranges)).toEqual(new Set(['8.8.8.0/24', '1.1.1.0/24', '9.9.9.0/24']));
    expect(capped).toBe(false);
    // invalid "bogus/99" counted as skipped, not added
    expect(sources.find((s) => s.url === 'https://a/list')).toMatchObject({ count: 2, skipped: 1, ok: true });
  });

  test('caps the resolved set to maxEntries', async () => {
    config.voipRanges.maxEntries = 2;
    const fetchImpl = makeFetch({ 'https://example.com/zoom.txt': '8.8.8.0/24\n1.1.1.0/24\n9.9.9.0/24' });

    const { ranges, capped } = await svc.resolveRanges({ fetchImpl });

    expect(ranges).toHaveLength(2);
    expect(capped).toBe(true);
  });

  test('falls back to the curated set when every source fails', async () => {
    const fetchImpl = makeFetch({ 'https://example.com/zoom.txt': new Error('ENOTFOUND') });

    const { ranges, sources } = await svc.resolveRanges({ fetchImpl });

    expect(ranges).toEqual(svc.CURATED_FALLBACK);
    expect(sources.some((s) => s.fallback)).toBe(true);
    expect(sources.some((s) => s.ok === false && /ENOTFOUND/.test(s.error))).toBe(true);
  });

  test('marks a non-200 response as a failed source', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 503, text: async () => '' }));
    const { sources } = await svc.resolveRanges({ fetchImpl });
    expect(sources[0]).toMatchObject({ ok: false });
    expect(sources[0].error).toMatch(/503/);
  });
});

// =============================================================================
// refreshAllNas
// =============================================================================
describe('refreshAllNas', () => {
  test('short-circuits when the feature is disabled', async () => {
    config.voipRanges.enabled = false;
    const result = await svc.refreshAllNas(1);
    expect(result).toEqual({ skipped: true, reason: 'VOIP_RANGES_ENABLED is false' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('resolves ranges once and aggregates per-NAS reconcile results', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '8.8.8.0/24\n1.1.1.0/24' }));
    db.query.mockResolvedValueOnce([[{ id: 1, api_username: 'x' }, { id: 2, api_username: 'y' }, { id: 3, api_username: 'z' }]]);
    routerProvisioningService.syncVoipAddressList
      .mockResolvedValueOnce({ added: 2, removed: 0, kept: 0, desired: 2 })   // nas 1
      .mockResolvedValueOnce({ skipped: true, reason: 'real-time priority not seeded on this NAS' }) // nas 2
      .mockRejectedValueOnce(new Error('router unreachable')); // nas 3

    const summary = await svc.refreshAllNas(null);

    expect(summary.ranges).toBe(2);
    expect(summary.nas_total).toBe(3);
    expect(summary.nas_synced).toBe(1);
    expect(summary.nas_skipped).toBe(1);
    expect(summary.nas_errors).toBe(1);
    expect(summary.added).toBe(2);
    // ranges resolved exactly once, then reused across all NAS
    expect(routerProvisioningService.syncVoipAddressList).toHaveBeenCalledTimes(3);
    expect(routerProvisioningService.syncVoipAddressList.mock.calls[0][1]).toEqual(['8.8.8.0/24', '1.1.1.0/24']);
    delete global.fetch;
  });

  test('skips when no ranges resolve', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    // curated fallback would normally kick in — force empty by stubbing resolve via empty fallback
    const origFallback = svc.CURATED_FALLBACK.slice();
    svc.CURATED_FALLBACK.length = 0;
    try {
      const result = await svc.refreshAllNas(null);
      expect(result.skipped).toBe(true);
      expect(result.reason).toMatch(/no VoIP ranges/);
      expect(db.query).not.toHaveBeenCalled();
    } finally {
      svc.CURATED_FALLBACK.push(...origFallback);
      delete global.fetch;
    }
  });
});
