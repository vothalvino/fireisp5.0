// =============================================================================
// FireISP 5.0 — Prometheus Metrics
// =============================================================================
// Lightweight Prometheus-compatible metrics endpoint at /metrics.
// No external dependency — generates text/plain Prometheus exposition format.
// =============================================================================

const { Router } = require('express');

const router = Router();

// ---------------------------------------------------------------------------
// Metric Counters
// ---------------------------------------------------------------------------
const counters = {
  http_requests_total: 0,
  http_request_errors_total: 0,
};

const histogramBuckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
/** @type {Map<string, number[]>} keyed by method:route */
const latencySamples = new Map();

/**
 * Middleware to record request count and latency.
 * Mount on Express *before* route handlers.
 */
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  counters.http_requests_total++;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const key = `${req.method}:${req.route ? req.route.path : req.path}`;

    if (!latencySamples.has(key)) {
      latencySamples.set(key, []);
    }
    const samples = latencySamples.get(key);
    samples.push(durationMs / 1000); // store in seconds
    // Keep only last 1000 samples per route to bound memory
    if (samples.length > 1000) samples.shift();

    if (res.statusCode >= 400) {
      counters.http_request_errors_total++;
    }
  });

  next();
}

/**
 * Build histogram buckets for a set of samples.
 */
function buildHistogram(name, labels, samples) {
  const lines = [];
  let sum = 0;
  const bucketCounts = histogramBuckets.map(() => 0);

  for (const s of samples) {
    sum += s;
    for (let i = 0; i < histogramBuckets.length; i++) {
      if (s <= histogramBuckets[i]) {
        bucketCounts[i]++;
      }
    }
  }

  for (let i = 0; i < histogramBuckets.length; i++) {
    // Cumulative
    const cumulative = bucketCounts.slice(0, i + 1).reduce((a, b) => a + b, 0);
    lines.push(`${name}_bucket{${labels},le="${histogramBuckets[i]}"} ${cumulative}`);
  }
  lines.push(`${name}_bucket{${labels},le="+Inf"} ${samples.length}`);
  lines.push(`${name}_sum{${labels}} ${sum.toFixed(6)}`);
  lines.push(`${name}_count{${labels}} ${samples.length}`);

  return lines;
}

/**
 * GET /metrics
 * Prometheus-compatible metrics endpoint.
 */
router.get('/', (_req, res) => {
  const lines = [];
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // ---- Process metrics ----
  lines.push('# HELP process_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${uptime.toFixed(2)}`);

  lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes');
  lines.push('# TYPE process_resident_memory_bytes gauge');
  lines.push(`process_resident_memory_bytes ${mem.rss}`);

  lines.push('# HELP process_heap_used_bytes V8 heap used in bytes');
  lines.push('# TYPE process_heap_used_bytes gauge');
  lines.push(`process_heap_used_bytes ${mem.heapUsed}`);

  lines.push('# HELP process_heap_total_bytes V8 heap total in bytes');
  lines.push('# TYPE process_heap_total_bytes gauge');
  lines.push(`process_heap_total_bytes ${mem.heapTotal}`);

  lines.push('# HELP nodejs_active_handles_total Number of active libuv handles');
  lines.push('# TYPE nodejs_active_handles_total gauge');
  lines.push(`nodejs_active_handles_total ${process._getActiveHandles ? process._getActiveHandles().length : 0}`);

  lines.push('# HELP nodejs_active_requests_total Number of active libuv requests');
  lines.push('# TYPE nodejs_active_requests_total gauge');
  lines.push(`nodejs_active_requests_total ${process._getActiveRequests ? process._getActiveRequests().length : 0}`);

  // ---- HTTP metrics ----
  lines.push('# HELP http_requests_total Total number of HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  lines.push(`http_requests_total ${counters.http_requests_total}`);

  lines.push('# HELP http_request_errors_total Total number of HTTP errors (4xx/5xx)');
  lines.push('# TYPE http_request_errors_total counter');
  lines.push(`http_request_errors_total ${counters.http_request_errors_total}`);

  // ---- Request latency histogram ----
  lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds');
  lines.push('# TYPE http_request_duration_seconds histogram');
  for (const [key, samples] of latencySamples.entries()) {
    const [method, path] = key.split(':');
    const labels = `method="${method}",path="${path}"`;
    lines.push(...buildHistogram('http_request_duration_seconds', labels, samples));
  }

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

module.exports = { router, metricsMiddleware, counters };
