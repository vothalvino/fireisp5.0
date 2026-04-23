// =============================================================================
// FireISP 5.0 — HTTP Response Cache Middleware (M5.6)
// =============================================================================
// Cache-aside middleware for GET endpoints.  Backed by cacheService (Redis
// when REDIS_URL is set, in-memory LRU otherwise).
//
// Cache key strategy — version tags
//   cache:ver:{orgId}:{resource}          integer version counter
//   cache:GET:{orgId}:{resource}:v{n}:{qs} response body
//
// When a mutation occurs for a resource, bustCache() increments the version
// counter so all previously cached keys naturally become unreachable (they
// expire via their own TTL).  This avoids the need for prefix-based key scans.
//
// Usage in a route file:
//   const { httpCache, bustCache } = require('../middleware/httpCache');
//
//   router.get('/', httpCache('plans', 300), ctrl.list);
//
//   router.post('/', validate(schema), async (req, res, next) => {
//     await ctrl.create(req, res, next);
//   });
//   // -- OR let crudController handle it via the cacheResource option --
// =============================================================================

const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

const VERSION_TTL = 86400; // keep version keys alive for 24 h

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the current cache version for an org+resource pair.
 * Returns 0 if the key has never been set (first ever request).
 * @param {number|string} orgId
 * @param {string} resource
 * @returns {Promise<number>}
 */
async function getVersion(orgId, resource) {
  const v = await cacheService.get(`cache:ver:${orgId}:${resource}`);
  return v === null || v === undefined ? 0 : v;
}

/**
 * Increment the version counter for an org+resource pair, invalidating all
 * previously cached responses for that resource without requiring key scans.
 * @param {number|string} orgId
 * @param {string} resource
 */
async function bustCache(orgId, resource) {
  if (!orgId || !resource) return;
  try {
    const current = await getVersion(orgId, resource);
    await cacheService.set(`cache:ver:${orgId}:${resource}`, current + 1, VERSION_TTL);
    logger.debug({ orgId, resource, version: current + 1 }, 'Cache busted');
  } catch (err) {
    // Busting is best-effort — a failure must not break the write path
    logger.warn({ err, orgId, resource }, 'httpCache: bustCache failed');
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Express middleware that caches successful GET responses in cacheService.
 *
 * @param {string} resource - Logical resource name (e.g. 'plans', 'clients').
 *   Used as part of the cache key and for version-based invalidation.
 * @param {number} ttl - Cache TTL in seconds.
 */
function httpCache(resource, ttl) {
  return async function httpCacheMiddleware(req, res, next) {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    const orgId = req.orgId || 'anon';

    // Sort query params for key stability regardless of insertion order
    const qs = Object.keys(req.query)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(req.query[k])}`)
      .join('&');

    let key;
    try {
      const version = await getVersion(orgId, resource);
      key = `cache:GET:${orgId}:${resource}:v${version}:${qs}`;
    } catch (err) {
      logger.warn({ err, resource }, 'httpCache: failed to read version — bypassing cache');
      return next();
    }

    // Cache hit — respond immediately
    try {
      const cached = await cacheService.get(key);
      if (cached !== null) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (err) {
      logger.warn({ err, key }, 'httpCache: cache get failed — bypassing cache');
      return next();
    }

    // Cache miss — intercept res.json to cache the response
    res.setHeader('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = async function cachedJson(body) {
      // Only cache 2xx responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          await cacheService.set(key, body, ttl);
        } catch (err) {
          logger.warn({ err, key }, 'httpCache: cache set failed');
        }
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = { httpCache, bustCache };
