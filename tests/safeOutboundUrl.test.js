// =============================================================================
// FireISP 5.0 — SSRF guard for tenant-configurable outbound URLs
// =============================================================================
const {
  assertSafeOutboundUrl,
  resolveSafeOutboundUrl,
  createPinnedLookup,
  isBlockedIp,
} = require('../src/utils/safeOutboundUrl');

describe('isBlockedIp', () => {
  test.each([
    '169.254.169.254', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fe90::1',
    'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '::7f00:1',
    '64:ff9b::7f00:1', '64:ff9b:1::7f00:1', 'ff02::1',
  ])('blocks %s', ip => expect(isBlockedIp(ip)).toBe(true));

  test.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700::1111'])(
    'allows public %s', ip => expect(isBlockedIp(ip)).toBe(false),
  );
});

describe('assertSafeOutboundUrl', () => {
  test('accepts an https public host', async () => {
    await expect(assertSafeOutboundUrl('https://8.8.8.8/hook')).resolves.toBe('https://8.8.8.8/hook');
  });

  test('rejects http (non-TLS)', async () => {
    await expect(assertSafeOutboundUrl('http://services.test.sw.com.mx'))
      .rejects.toMatchObject({ statusCode: 422, code: 'UNSAFE_URL' });
  });

  test('rejects the cloud metadata IP', async () => {
    await expect(assertSafeOutboundUrl('https://169.254.169.254/latest/meta-data/'))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  test('rejects loopback by name and by literal', async () => {
    await expect(assertSafeOutboundUrl('https://localhost/x')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    await expect(assertSafeOutboundUrl('https://api.localhost/x')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    await expect(assertSafeOutboundUrl('https://127.0.0.1:3306')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  test('rejects URL credentials and fragments', async () => {
    await expect(assertSafeOutboundUrl('https://user:secret@8.8.8.8/hook'))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' });
    await expect(assertSafeOutboundUrl('https://8.8.8.8/hook#ignored'))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  test('rejects private ranges by literal IP', async () => {
    for (const u of ['https://10.0.0.5', 'https://192.168.1.1', 'https://172.16.9.9']) {
      await expect(assertSafeOutboundUrl(u)).rejects.toMatchObject({ code: 'UNSAFE_URL' });
    }
  });

  test('rejects a hostname that RESOLVES to a private address', async () => {
    const dns = require('dns').promises;
    const spy = jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '10.0.0.9', family: 4 }]);
    await expect(assertSafeOutboundUrl('https://sneaky.example.com'))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' });
    spy.mockRestore();
  });

  test('rejects a host when any returned address is private', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.9', family: 4 },
    ]);

    await expect(assertSafeOutboundUrl('https://mixed.example/hook', 'url', { lookup }))
      .rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  test('settles within the DNS deadline when lookup never resolves', async () => {
    jest.useFakeTimers();
    try {
      const lookup = jest.fn(() => new Promise(() => {}));
      const result = assertSafeOutboundUrl('https://never-resolves.example/hook', 'url', {
        lookup,
        timeoutMs: 25,
      });
      const rejection = expect(result).rejects.toMatchObject({ code: 'UNSAFE_URL' });

      await jest.advanceTimersByTimeAsync(25);
      await rejection;
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('rejects a malformed URL', async () => {
    await expect(assertSafeOutboundUrl('not a url')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });
});

describe('delivery-time DNS pinning', () => {
  test('returns a lookup callback pinned to the addresses that were validated', async () => {
    const lookup = jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const resolved = await resolveSafeOutboundUrl('https://traps.example/hook', 'url', { lookup });

    expect(lookup).toHaveBeenCalledTimes(1);
    await expect(new Promise((resolve, reject) => {
      resolved.lookup('traps.example', { family: 4 }, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    })).resolves.toEqual({ address: '8.8.8.8', family: 4 });
  });

  test('fails closed when the transport requests an unvalidated address family', async () => {
    const lookup = createPinnedLookup([{ address: '8.8.8.8', family: 4 }]);

    await expect(new Promise((resolve, reject) => {
      lookup('traps.example', { family: 6 }, (err, address) => {
        if (err) reject(err);
        else resolve(address);
      });
    })).rejects.toMatchObject({ code: 'ENOTFOUND' });
  });
});
