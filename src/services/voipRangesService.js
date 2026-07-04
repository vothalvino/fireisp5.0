// =============================================================================
// FireISP 5.0 — VoIP / RTC Address-List Auto-Updater
// =============================================================================
// Keeps the `fireisp-voip` firewall address-list on managed MikroTik NAS current
// with real-time-communication (RTC) provider IP ranges, so the §VoIP realtime-
// priority mangle (routerProvisioningService.seedRealtimePriority) keeps matching
// live call/media servers as providers rotate their netblocks.
//
// Design:
//   • Ranges are FETCHED from operator-configurable source URLs (config.voipRanges
//     .sourceUrls) — plain-CIDR-per-line OR Google-style JSON — not hardcoded, so
//     they stay current without shipping stale netblocks. A tiny curated fallback
//     covers the offline / all-sources-failed case.
//   • Only providers that are real-time-ONLY (e.g. Zoom) are defaulted; broad
//     ranges (all-of-Meta/Google) over-match bulk traffic and are left to the
//     operator (seed-time `voipNetworks`, tagged `fireisp-voip`, untouched here).
//   • The device push RECONCILES only entries this updater owns (comment
//     `fireisp-voip-auto`) and skips NAS that never seeded realtime priority.
// =============================================================================

const config = require('../config');
const db = require('../config/database');
const routerProvisioningService = require('./routerProvisioningService');
const logger = require('../utils/logger').child({ service: 'voipRanges' });

// Curated fallback — a handful of Zoom-owned larger allocations, used ONLY when no
// source is configured or every fetch fails. Verify against the live source
// (assets.zoom.us/docs/ipranges/Zoom.txt); the fetch path is the source of truth.
const CURATED_FALLBACK = [
  '149.137.0.0/17',
  '152.116.0.0/16',
  '170.114.0.0/16',
  '198.251.128.0/17',
  '206.247.0.0/16',
];

// =============================================================================
// CIDR helpers
// =============================================================================

/**
 * Strict IPv4 CIDR / bare-IPv4 validator. The `/ip/firewall/address-list` is IPv4
 * (IPv6 lists live under /ipv6) so non-IPv4 entries are filtered out upstream.
 * Accepts "a.b.c.d" and "a.b.c.d/nn" with each octet 0-255 and prefix 0-32.
 * @param {string} s
 * @returns {boolean}
 */
function isIpv4Cidr(s) {
  if (typeof s !== 'string') return false;
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o < 0 || o > 255) return false;
  }
  if (m[5] !== undefined) {
    const p = Number(m[5]);
    if (p < 0 || p > 32) return false;
  }
  return true;
}

/**
 * Parse a fetched source body into an array of CIDR strings. Auto-detects:
 *   • Google-style JSON: { prefixes: [ { ipv4Prefix: "8.8.8.0/24" }, … ] }
 *   • Plain text: one CIDR (or IP) per line; blank lines and `#`/`;` comments skipped.
 * Returns raw tokens (validation/dedup happens in resolveRanges).
 * @param {string} body
 * @returns {string[]}
 */
function parseSourceBody(body) {
  if (!body || typeof body !== 'string') return [];
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      const prefixes = Array.isArray(json) ? json : (json.prefixes || json.ranges || []);
      const out = [];
      for (const p of prefixes) {
        if (typeof p === 'string') out.push(p);
        else if (p && typeof p === 'object') {
          if (p.ipv4Prefix) out.push(p.ipv4Prefix);
          else if (p.ip_prefix) out.push(p.ip_prefix); // AWS-style
          else if (p.cidr) out.push(p.cidr);
        }
      }
      return out;
    } catch {
      // Not valid JSON despite the leading brace — fall through to line parsing.
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith(';'));
}

// =============================================================================
// Range resolution
// =============================================================================

/**
 * Fetch one source URL and return its raw body text, enforcing a timeout.
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function fetchSource(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the current de-duplicated, validated, capped set of IPv4 VoIP/RTC CIDRs
 * from the configured sources. Falls back to CURATED_FALLBACK only when nothing
 * usable was fetched.
 *
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ranges: string[], sources: Array<object>, capped: boolean }>}
 */
async function resolveRanges({ fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const { sourceUrls, maxEntries, fetchTimeoutMs } = config.voipRanges;

  const collected = new Set();
  const sources = [];

  for (const url of sourceUrls) {
    if (!doFetch) {
      sources.push({ url, count: 0, ok: false, error: 'no fetch implementation available' });
      continue;
    }
    try {
      const body = await fetchSource(url, doFetch, fetchTimeoutMs);
      const parsed = parseSourceBody(body);
      const valid = parsed.filter(isIpv4Cidr);
      valid.forEach((c) => collected.add(c));
      sources.push({ url, count: valid.length, skipped: parsed.length - valid.length, ok: true });
    } catch (err) {
      sources.push({ url, count: 0, ok: false, error: err.message });
      logger.warn({ url, err: err.message }, 'VoIP range source fetch failed');
    }
  }

  if (collected.size === 0) {
    CURATED_FALLBACK.filter(isIpv4Cidr).forEach((c) => collected.add(c));
    sources.push({ url: '(curated fallback)', count: collected.size, ok: true, fallback: true });
    logger.warn('All VoIP range sources failed/empty — using curated fallback');
  }

  let ranges = [...collected];
  let capped = false;
  if (ranges.length > maxEntries) {
    ranges = ranges.slice(0, maxEntries);
    capped = true;
    logger.warn({ resolved: collected.size, cap: maxEntries }, 'VoIP ranges exceeded cap — truncated');
  }

  return { ranges, sources, capped };
}

// =============================================================================
// Device fan-out
// =============================================================================

/**
 * Resolve ranges once, then reconcile the fireisp-voip address-list on every
 * managed NAS (with API credentials) in scope. NAS that never seeded realtime
 * priority are skipped by syncVoipAddressList.
 *
 * @param {number|null} [organizationId=null]
 * @returns {Promise<object>} summary report
 */
async function refreshAllNas(organizationId = null) {
  if (!config.voipRanges.enabled) {
    return { skipped: true, reason: 'VOIP_RANGES_ENABLED is false' };
  }

  const { ranges, sources, capped } = await resolveRanges();
  if (!ranges.length) {
    return { skipped: true, reason: 'no VoIP ranges resolved', sources };
  }

  const orgFilter = organizationId ? 'AND organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];
  const [nasRows] = await db.query(
    `SELECT * FROM nas
     WHERE deleted_at IS NULL
       AND api_username IS NOT NULL AND api_username <> ''
       ${orgFilter}`,
    params,
  );

  const results = [];
  for (const nas of nasRows) {
    try {
      const r = await routerProvisioningService.syncVoipAddressList(nas, ranges);
      results.push({ nasId: nas.id, ...r });
    } catch (err) {
      // A single unreachable/misconfigured NAS must not abort the whole sweep.
      results.push({ nasId: nas.id, error: err.message });
    }
  }

  const summary = {
    ranges: ranges.length,
    capped,
    sources,
    nas_total: nasRows.length,
    nas_synced: results.filter((r) => !r.skipped && !r.error).length,
    nas_skipped: results.filter((r) => r.skipped).length,
    nas_errors: results.filter((r) => r.error).length,
    added: results.reduce((a, r) => a + (r.added || 0), 0),
    removed: results.reduce((a, r) => a + (r.removed || 0), 0),
    results,
  };
  logger.info(
    { organizationId, ranges: summary.ranges, nas_total: summary.nas_total, nas_synced: summary.nas_synced, added: summary.added, removed: summary.removed },
    'VoIP ranges refresh complete',
  );
  return summary;
}

module.exports = {
  isIpv4Cidr,
  parseSourceBody,
  resolveRanges,
  refreshAllNas,
  CURATED_FALLBACK,
};
