// =============================================================================
// FireISP 5.0 — Cache Service
// =============================================================================
// Provides a caching interface that works with or without Redis.
// When REDIS_URL is set, uses Redis. Otherwise falls back to an in-memory
// LRU cache suitable for single-instance deployments.
//
// Usage:
//   const cache = require('./cacheService');
//   await cache.get('plans:all');
//   await cache.set('plans:all', data, 300);  // TTL in seconds
//   await cache.del('plans:all');
//   await cache.wrap('plans:all', 300, () => db.query('SELECT * FROM plans'));
// =============================================================================

const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// In-memory LRU cache (fallback when Redis is not available)
// ---------------------------------------------------------------------------
class MemoryCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    /** @type {Map<string, {value: any, expiresAt: number}>} */
    this.store = new Map();
  }

  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  async set(key, value, ttlSeconds) {
    // Evict oldest if at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
    });
  }

  async del(key) {
    this.store.delete(key);
  }

  async flush() {
    this.store.clear();
  }

  async close() {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Redis wrapper (optional — only used when REDIS_URL is set)
// ---------------------------------------------------------------------------
class RedisCache {
  constructor(client) {
    this.client = client;
  }

  async get(key) {
    try {
      const raw = await this.client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      logger.warn({ err, key }, 'Cache get failed');
      return null;
    }
  }

  async set(key, value, ttlSeconds) {
    try {
      const raw = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, raw, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, raw);
      }
    } catch (err) {
      logger.warn({ err, key }, 'Cache set failed');
    }
  }

  async del(key) {
    try {
      await this.client.del(key);
    } catch (err) {
      logger.warn({ err, key }, 'Cache del failed');
    }
  }

  async flush() {
    try {
      await this.client.flushdb();
    } catch (err) {
      logger.warn({ err }, 'Cache flush failed');
    }
  }

  async close() {
    try {
      await this.client.quit();
    } catch (err) { logger.debug({ err }, 'Redis close error'); }
  }
}

// ---------------------------------------------------------------------------
// Factory — create the appropriate cache implementation
// ---------------------------------------------------------------------------
let instance = null;

function createCache() {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      // Only require ioredis if REDIS_URL is set — it's an optional dependency
      const Redis = require('ioredis');
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
        lazyConnect: true,
      });

      client.on('error', (err) => logger.warn({ err }, 'Redis connection error'));
      client.on('connect', () => logger.info('Redis cache connected'));

      client.connect().catch(() => {
        logger.warn('Redis connection failed — falling back to in-memory cache');
        instance = new MemoryCache();
      });

      return new RedisCache(client);
    } catch (_err) {
      logger.info('ioredis not installed — using in-memory cache');
    }
  }

  logger.info('Using in-memory LRU cache (set REDIS_URL + install ioredis for Redis)');
  return new MemoryCache();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function getCache() {
  if (!instance) {
    instance = createCache();
  }
  return instance;
}

/**
 * Cache-aside helper: get from cache, or execute fn and store result.
 * @param {string} key - Cache key
 * @param {number} ttl - TTL in seconds
 * @param {Function} fn - Async function to call on cache miss
 */
async function wrap(key, ttl, fn) {
  const cache = getCache();
  const cached = await cache.get(key);
  if (cached !== null) return cached;
  const result = await fn();
  await cache.set(key, result, ttl);
  return result;
}

module.exports = {
  get: (key) => getCache().get(key),
  set: (key, value, ttl) => getCache().set(key, value, ttl),
  del: (key) => getCache().del(key),
  flush: () => getCache().flush(),
  close: () => getCache().close(),
  wrap,
};
