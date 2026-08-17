// =============================================================================
// FireISP 5.0 — SSRF guard for tenant-configurable outbound URLs
// =============================================================================
// Write-time validation alone is not enough: a hostname can resolve publicly
// when it is saved and privately when it is used (DNS rebinding). Callers that
// perform network I/O should use resolveSafeOutboundUrl() and pass the returned
// lookup function to http(s).request. That pins the request to the public
// addresses checked here, so the transport does not perform a second lookup.
// =============================================================================

const dns = require('dns').promises;
const net = require('net');
const { AppError } = require('./errors');

const DEFAULT_DNS_TIMEOUT_MS = 5000;

function parseIpv4(ip) {
  if (net.isIP(ip) !== 4) return null;
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

/** Expand a valid IPv6 address into eight 16-bit words. */
function parseIpv6(ip) {
  if (net.isIP(ip) !== 6) return null;
  let value = String(ip).toLowerCase().split('%')[0];
  const dotted = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = parseIpv4(dotted[1]);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, dotted.index)}${hi}:${lo}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
    .map(word => parseInt(word || '0', 16));
  if (words.length !== 8 || words.some(word => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  return words;
}

function mappedIpv4(words) {
  if (!words || words.length !== 8) return null;
  if (!words.slice(0, 5).every(word => word === 0) || words[5] !== 0xffff) return null;
  return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
}

function isBlockedIpv4(octets) {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;                // shared CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                          // link-local + common metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;                 // IETF assignments / metadata
  if (a === 192 && b === 0 && c === 2) return true;                 // documentation
  if (a === 198 && (b === 18 || b === 19)) return true;             // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;                                        // multicast / reserved
  return false;
}

function isBlockedIp(ip) {
  const normalized = String(ip || '').split('%')[0];
  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isBlockedIpv4(ipv4);

  const words = parseIpv6(normalized);
  if (!words) return true;
  const mapped = mappedIpv4(words);
  if (mapped) return isBlockedIpv4(mapped);

  // Deprecated IPv4-compatible addresses (::/96), NAT64, and 6to4 can hide
  // an IPv4 destination inside an IPv6 literal. Evaluate the embedded address
  // too; local-use NAT64 is blocked wholesale because its translation policy
  // is controlled by the local network and cannot be proven public here.
  const embeddedTail = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
  if (words.slice(0, 6).every(word => word === 0)) return true;       // IPv4-compatible ::/96
  if (words.slice(0, 4).every(word => word === 0)
      && words[4] === 0xffff && words[5] === 0) return true;          // RFC 6145 IPv4-translatable ::ffff:0:0/96
  if (words[0] === 0x0064 && words[1] === 0xff9b
      && words.slice(2, 6).every(word => word === 0)
      && isBlockedIpv4(embeddedTail)) return true;                    // well-known NAT64 64:ff9b::/96
  if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0x0001) return true; // local-use NAT64 /48
  if (words[0] === 0x2002
      && isBlockedIpv4([words[1] >> 8, words[1] & 0xff, words[2] >> 8, words[2] & 0xff])) return true; // 6to4

  const allZeroPrefix = words.slice(0, 7).every(word => word === 0);
  if (allZeroPrefix && (words[7] === 0 || words[7] === 1)) return true; // :: / ::1
  if ((words[0] & 0xfe00) === 0xfc00) return true;                    // unique-local fc00::/7
  if ((words[0] & 0xffc0) === 0xfe80) return true;                    // link-local fe80::/10
  if ((words[0] & 0xffc0) === 0xfec0) return true;                    // deprecated site-local
  if ((words[0] & 0xff00) === 0xff00) return true;                    // multicast
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;        // documentation
  return false;
}

function normalizeAndCheckUrl(raw, field) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch (_) {
    throw new AppError(`${field} is not a valid URL.`, 422, 'UNSAFE_URL');
  }
  if (url.protocol !== 'https:') {
    throw new AppError(`${field} must use https.`, 422, 'UNSAFE_URL');
  }
  if (url.username || url.password) {
    throw new AppError(`${field} must not include credentials.`, 422, 'UNSAFE_URL');
  }
  if (url.hash) {
    throw new AppError(`${field} must not include a fragment.`, 422, 'UNSAFE_URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) {
    throw new AppError(`${field} must not target a private or loopback host.`, 422, 'UNSAFE_URL');
  }
  return { url, host };
}

function resolutionTimeoutError(field, code) {
  if (code === 'ETIMEDOUT') {
    return Object.assign(new Error('Forwarding destination resolution timed out'), { code: 'ETIMEDOUT' });
  }
  return new AppError(`${field} host resolution timed out.`, 422, 'UNSAFE_URL');
}

async function resolveHost(host, field, options = {}) {
  const lookup = options.lookup || dns.lookup;
  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_DNS_TIMEOUT_MS);
    let timer;
    try {
      addresses = await Promise.race([
        Promise.resolve().then(() => lookup(host, { all: true, verbatim: true })),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(resolutionTimeoutError(field, options.timeoutCode)),
            timeoutMs,
          );
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } catch (err) {
      if (err?.code === 'ETIMEDOUT' || err?.code === 'UNSAFE_URL') throw err;
      throw new AppError(`${field} host could not be resolved.`, 422, 'UNSAFE_URL');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const normalized = (Array.isArray(addresses) ? addresses : [addresses])
    .map(entry => typeof entry === 'string'
      ? { address: entry, family: net.isIP(entry) }
      : { address: entry?.address, family: Number(entry?.family) || net.isIP(entry?.address) })
    .filter(entry => entry.address && (entry.family === 4 || entry.family === 6));

  if (normalized.length === 0 || normalized.some(entry => isBlockedIp(entry.address))) {
    throw new AppError(
      `${field} must not target a private, loopback, link-local, or metadata address.`,
      422,
      'UNSAFE_URL',
    );
  }
  return normalized;
}

/** Build a Node request lookup callback pinned to already-validated addresses. */
function createPinnedLookup(addresses) {
  const safe = addresses.map(entry => ({ address: entry.address, family: Number(entry.family) }));
  return (_hostname, options, callback) => {
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    const family = Number(opts.family) || 0;
    const candidates = family ? safe.filter(entry => entry.family === family) : safe;
    if (!candidates.length) {
      callback(Object.assign(new Error('No validated address matches the requested IP family'), { code: 'ENOTFOUND' }));
      return;
    }
    if (opts.all) {
      callback(null, candidates);
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}

async function resolveSafeOutboundUrl(raw, field = 'url', options = {}) {
  const { url, host } = normalizeAndCheckUrl(raw, field);
  const addresses = await resolveHost(host, field, options);
  return { url, addresses, lookup: createPinnedLookup(addresses) };
}

/** Validate an HTTPS URL at write time and return its normalized form. */
async function assertSafeOutboundUrl(raw, field = 'api_url', options = {}) {
  const resolved = await resolveSafeOutboundUrl(raw, field, options);
  return resolved.url.toString();
}

module.exports = {
  assertSafeOutboundUrl,
  resolveSafeOutboundUrl,
  createPinnedLookup,
  isBlockedIp,
  DEFAULT_DNS_TIMEOUT_MS,
};
