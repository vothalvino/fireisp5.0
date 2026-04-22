// =============================================================================
// FireISP 5.0 — API Load Test Runner (Roadmap 4.1)
// =============================================================================
// Drives autocannon against a running FireISP API to validate that the
// `realistic ISP workload` target from roadmap 4.1 (500 clients, 5000
// invoices, 100 devices) holds up under sustained read traffic.
//
// What it does:
//   1. Logs in once with the load-test admin credentials to obtain a JWT
//      (the same token is reused by every connection).
//   2. Runs a sequence of autocannon scenarios against the most-hit list
//      endpoints (clients, invoices, devices) — pagination included.
//   3. Prints a per-scenario summary (req/sec, p50/p95/p99 latency, errors)
//      followed by an aggregate verdict.
//
// Prerequisites:
//   * The API is running and reachable at LOADTEST_URL (default
//     http://127.0.0.1:3000).
//   * The fixture has been seeded:  `npm run loadtest:seed`.
//
// Configuration (env vars, all optional):
//   LOADTEST_URL         — API base URL                    (default http://127.0.0.1:3000)
//   LOADTEST_EMAIL       — login email                     (default loadtest@fireisp.local)
//   LOADTEST_PASSWORD    — login password                  (default loadtest123!)
//   LOADTEST_DURATION    — seconds per scenario            (default 10)
//   LOADTEST_CONNECTIONS — concurrent connections          (default 25)
//   LOADTEST_PIPELINING  — pipelined requests / connection (default 1)
//
// Usage:
//   node src/scripts/loadtest.js
//   npm run loadtest
// =============================================================================

require('dotenv').config();
const http = require('http');
const https = require('https');
const { URL } = require('url');
const autocannon = require('autocannon');
const logger = require('../utils/logger').child({ script: 'loadtest' });

const BASE_URL = (process.env.LOADTEST_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const EMAIL = process.env.LOADTEST_EMAIL || 'loadtest@fireisp.local';
const PASSWORD = process.env.LOADTEST_PASSWORD || 'loadtest123!';
const DURATION = parseInt(process.env.LOADTEST_DURATION, 10) || 10;
const CONNECTIONS = parseInt(process.env.LOADTEST_CONNECTIONS, 10) || 25;
const PIPELINING = parseInt(process.env.LOADTEST_PIPELINING, 10) || 1;

/**
 * POST JSON to a URL and parse the JSON response. Used only for the one-shot
 * login that precedes the load test — autocannon handles the actual load.
 */
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = { raw }; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new Error(`POST ${url} returned ${res.statusCode}: ${raw}`);
            err.statusCode = res.statusCode;
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Run a single autocannon scenario. Resolves with the result object.
 */
function runScenario({ name, path, token, auth = true }) {
  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json' };
    if (auth !== false && token) headers.authorization = `Bearer ${token}`;
    const instance = autocannon(
      {
        url: BASE_URL + path,
        method: 'GET',
        connections: CONNECTIONS,
        pipelining: PIPELINING,
        duration: DURATION,
        headers,
        title: name,
      },
      (err, result) => {
        if (err) return reject(err);
        result.scenarioName = name;
        result.scenarioPath = path;
        resolve(result);
      },
    );
    // Forward progress to stderr so the live bar doesn't pollute logs.
    autocannon.track(instance, { renderProgressBar: process.stderr.isTTY });
  });
}

function summarizeScenario(r) {
  return {
    name: r.scenarioName,
    path: r.scenarioPath,
    durationSec: r.duration,
    totalRequests: r.requests.total,
    completedRequests: r.requests.sent - (r.errors + r.timeouts),
    reqPerSec: Math.round(r.requests.average),
    bytesPerSec: r.throughput.average,
    latencyMs: {
      p50: r.latency.p50,
      p90: r.latency.p90,
      p975: r.latency.p97_5,
      p99: r.latency.p99,
      max: r.latency.max,
    },
    non2xx: r.non2xx,
    errors: r.errors,
    timeouts: r.timeouts,
    statusCodes: { '1xx': r['1xx'], '2xx': r['2xx'], '3xx': r['3xx'], '4xx': r['4xx'], '5xx': r['5xx'] },
  };
}

async function main() {
  logger.info({ BASE_URL, EMAIL, DURATION, CONNECTIONS, PIPELINING }, 'Starting FireISP 4.1 load test');

  // ---------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------
  let loginResp;
  try {
    loginResp = await postJson(`${BASE_URL}/api/v1/auth/login`, {
      email: EMAIL,
      password: PASSWORD,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Login failed — did you run `npm run loadtest:seed` and start the API?');
    process.exit(2);
  }
  const token = (loginResp.data && loginResp.data.accessToken) || loginResp.accessToken;
  if (!token) {
    logger.error({ loginResp }, 'Login response did not contain an accessToken');
    process.exit(2);
  }
  logger.info('Authenticated successfully');

  // ---------------------------------------------------------------
  // Scenarios — exercise the heaviest read paths an ISP operator hits.
  // We probe both the cheap baseline (`/health`) and authenticated
  // record/list endpoints so the report covers the full stack
  // (TLS termination → middleware → auth → controller → model → DB).
  // ---------------------------------------------------------------
  const scenarios = [
    { name: 'GET /health (baseline, no auth)',  path: '/health',                                         auth: false },
    { name: 'GET /clients/1 (single record)',   path: '/api/v1/clients/1' },
    { name: 'GET /clients/250 (mid-range id)',  path: '/api/v1/clients/250' },
    { name: 'GET /clients/500 (last id)',       path: '/api/v1/clients/500' },
    { name: 'GET /clients (list, page 1)',      path: '/api/v1/clients?page=1&limit=50' },
    { name: 'GET /invoices (list, page 1)',     path: '/api/v1/invoices?page=1&limit=50' },
    { name: 'GET /devices (list, page 1)',      path: '/api/v1/devices?page=1&limit=50' },
  ];

  const results = [];
  for (const scenario of scenarios) {
    logger.info({ scenario: scenario.name }, 'Running scenario');
     
    const r = await runScenario({ ...scenario, token });
     
    const summary = summarizeScenario(r);
    results.push(summary);
    logger.info(summary, 'Scenario complete');
  }

  // ---------------------------------------------------------------
  // Final report
  // ---------------------------------------------------------------
  const totalRequests = results.reduce((s, r) => s + r.totalRequests, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors + r.timeouts + r.non2xx, 0);
  const worstP99 = Math.max(...results.map(r => r.latencyMs.p99 || 0));
  const aggregate = {
    scenarios: results.length,
    totalRequests,
    totalErrors,
    errorRate: totalRequests > 0 ? +(totalErrors / totalRequests).toFixed(4) : 0,
    worstP99LatencyMs: worstP99,
  };
  logger.info(aggregate, 'Load test complete');

  // Mirror a human-readable summary to stdout (separate from JSON logs)
  console.log('\n=== FireISP 4.1 Load Test — Summary ===');
  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(40)}  ${String(r.reqPerSec).padStart(6)} req/s  ` +
      `p50=${String(r.latencyMs.p50).padStart(4)}ms  ` +
      `p97.5=${String(r.latencyMs.p975).padStart(4)}ms  ` +
      `p99=${String(r.latencyMs.p99).padStart(4)}ms  ` +
      `2xx=${r.statusCodes['2xx']}  4xx=${r.statusCodes['4xx']}  5xx=${r.statusCodes['5xx']}  errors=${r.errors}`,
    );
  }
  console.log('  ----');
  console.log(`  total requests = ${aggregate.totalRequests}, error rate = ${(aggregate.errorRate * 100).toFixed(2)}%, worst p99 = ${aggregate.worstP99LatencyMs}ms`);

  // Exit non-zero if any scenario produced 5xx / network errors so CI
  // can gate on the load test if it is wired into a pipeline.
  const hadFailures = results.some(r => r.errors > 0 || r.timeouts > 0 || (r.statusCodes && r.statusCodes['5xx'] > 0));
  process.exit(hadFailures ? 1 : 0);
}

if (require.main === module) {
  main().catch(err => {
    logger.error({ err: err && err.message, stack: err && err.stack }, 'Load test crashed');
    process.exit(1);
  });
}

module.exports = { main };
