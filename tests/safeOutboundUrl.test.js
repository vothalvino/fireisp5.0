// =============================================================================
// FireISP 5.0 — SSRF guard for tenant-configurable outbound URLs
// =============================================================================
const { assertSafeOutboundUrl, isBlockedIp } = require('../src/utils/safeOutboundUrl');

describe('isBlockedIp', () => {
  test.each([
    '169.254.169.254', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1',
  ])('blocks %s', ip => expect(isBlockedIp(ip)).toBe(true));

  test.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700::1111'])(
    'allows public %s', ip => expect(isBlockedIp(ip)).toBe(false),
  );
});

describe('assertSafeOutboundUrl', () => {
  test('accepts an https public host', async () => {
    await expect(assertSafeOutboundUrl('https://services.test.sw.com.mx')).resolves.toContain('https://');
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
    await expect(assertSafeOutboundUrl('https://127.0.0.1:3306')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
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

  test('rejects a malformed URL', async () => {
    await expect(assertSafeOutboundUrl('not a url')).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });
});
