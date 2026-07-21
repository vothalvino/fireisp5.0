// =============================================================================
// FireISP 5.0 — SSRF guard for tenant-configurable outbound URLs
// =============================================================================
// pac_providers.api_url is written by an org-scoped tenant admin and later
// used as the target of server-side POSTs (PAC stamping/cancel). Without a
// guard a tenant could point it at the cloud metadata endpoint or an internal
// service and make the FireISP host issue the request on their behalf — a
// cross-tenant SSRF (IAM-credential disclosure on IMDSv1, internal port
// probing), not mere self-harm. Validate on write: https only, and no
// private/loopback/link-local/metadata destination — resolving the hostname
// so a public name that maps to a private address is still rejected.
// =============================================================================

const dns = require('dns').promises;
const net = require('net');
const { AppError } = require('./errors');

// Private / loopback / link-local / unique-local / metadata ranges.
function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;                          // 10/8
    if (a === 127) return true;                         // loopback
    if (a === 0) return true;                           // 0.0.0.0/8
    if (a === 169 && b === 254) return true;            // link-local + metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16/12
    if (a === 192 && b === 168) return true;            // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64/10 CGNAT
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    if (lc === '::1' || lc === '::') return true;                    // loopback / unspecified
    if (lc.startsWith('fe80')) return true;                         // link-local
    if (lc.startsWith('fc') || lc.startsWith('fd')) return true;    // unique-local fc00::/7
    if (lc.startsWith('::ffff:')) return isBlockedIp(lc.slice(7));  // IPv4-mapped
    return false;
  }
  return false;
}

/**
 * Throw AppError(422 UNSAFE_URL) unless `raw` is an https URL whose host is
 * public. Returns the normalized URL string on success.
 */
async function assertSafeOutboundUrl(raw, field = 'api_url') {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch (_) {
    throw new AppError(`${field} is not a valid URL.`, 422, 'UNSAFE_URL');
  }
  if (url.protocol !== 'https:') {
    throw new AppError(`${field} must use https.`, 422, 'UNSAFE_URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost') {
    throw new AppError(`${field} must not target a private or loopback host.`, 422, 'UNSAFE_URL');
  }
  // Literal IP in the URL, or resolve the hostname — reject if ANY resolved
  // address is in a blocked range (defends against a public name pointing at
  // an internal IP).
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map(r => r.address);
    } catch (_) {
      throw new AppError(`${field} host could not be resolved.`, 422, 'UNSAFE_URL');
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw new AppError(`${field} must not target a private, loopback, or metadata address.`, 422, 'UNSAFE_URL');
  }
  return url.toString();
}

module.exports = { assertSafeOutboundUrl, isBlockedIp };
