'use strict';

const { canonicalIpv6, canonicalIpv6Prefix } = require('../src/utils/ipAddress');

describe('IP address canonicalization', () => {
  test('canonicalizes equivalent IPv6 spellings', () => {
    expect(canonicalIpv6('2001:0DB8:0000:0000:0000:0000:0000:0001'))
      .toBe('2001:db8::1');
    expect(canonicalIpv6Prefix('2001:0db8:0000:0000::/056'))
      .toBe('2001:db8::/56');
  });

  test('rejects invalid addresses and prefix lengths', () => {
    expect(() => canonicalIpv6('192.0.2.1')).toThrow(/IPv6/);
    expect(() => canonicalIpv6Prefix('2001:db8::/129')).toThrow(/prefix length/);
  });
});
