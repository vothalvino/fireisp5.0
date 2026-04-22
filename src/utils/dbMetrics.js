// =============================================================================
// FireISP 5.0 — DB Query Metrics Recorder
// =============================================================================
// Standalone module that accumulates db_query_duration_seconds histogram
// samples. Imported by both src/config/database.js (to record) and
// src/routes/metrics.js (to expose via /metrics endpoint).
// Keeping this separate avoids a routes→config circular dependency.
// =============================================================================

const dbQueryBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

/** @type {Map<string, number[]>} keyed by SQL operation (SELECT, INSERT, ...) */
const dbQuerySamples = new Map();

/**
 * Record a DB query duration sample.
 * @param {number} durationSeconds
 * @param {string} [operation='OTHER']
 */
function recordDbQuery(durationSeconds, operation = 'OTHER') {
  if (!dbQuerySamples.has(operation)) {
    dbQuerySamples.set(operation, []);
  }
  const samples = dbQuerySamples.get(operation);
  samples.push(durationSeconds);
  // Keep only last 2000 samples per operation to bound memory
  if (samples.length > 2000) samples.shift();
}

module.exports = { recordDbQuery, dbQuerySamples, dbQueryBuckets };
