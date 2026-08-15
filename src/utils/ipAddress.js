'use strict';

const net = require('net');

function canonicalIpv6(value) {
  if (typeof value !== 'string' || net.isIP(value) !== 6) {
    throw new TypeError('Expected an IPv6 address');
  }
  // WHATWG URL host parsing applies RFC 5952-compatible zero compression and
  // lowercase hex. Strip the brackets added for an IPv6 URL host.
  const host = new URL(`http://[${value}]/`).hostname;
  return host.slice(1, -1).toLowerCase();
}

function canonicalIpv6Prefix(value) {
  if (typeof value !== 'string') throw new TypeError('Expected an IPv6 prefix');
  const match = value.trim().match(/^(.+)\/(\d{1,3})$/);
  if (!match) throw new TypeError('Expected an IPv6 CIDR prefix');
  const prefixLength = Number(match[2]);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 128) {
    throw new TypeError('Invalid IPv6 prefix length');
  }
  return `${canonicalIpv6(match[1])}/${prefixLength}`;
}

module.exports = { canonicalIpv6, canonicalIpv6Prefix };
