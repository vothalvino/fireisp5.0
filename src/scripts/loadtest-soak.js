// =============================================================================
// FireISP 5.0 — Soak Test Runner (Roadmap P1.6)
// =============================================================================
// Drives a low-rate, long-duration soak test against a running FireISP API
// to catch memory leaks, file-descriptor leaks, and connection-pool exhaustion
// that only surface under sustained load over time.
//
// What it does:
//   1. Authenticates once with the load-test admin credentials.
//   2. Loops autocannon rounds — each round runs SOAK_ROUND_DURATION seconds
//      at SOAK_CONNECTIONS concurrent connections.
//   3. After each round, samples Node.js RSS from a remote /health?detail=true
//      call and checks that RSS has not grown more than SOAK_MAX_RSS_GROWTH_MB
//      since the start.
//   4. Continues until SOAK_TOTAL_DURATION seconds have elapsed or a violation
//      is detected.
//   5. Prints a summary table and exits 0 on success, non-zero on any error,
//      5xx responses, or memory-growth budget breach.
//
// For CI / release candidate gating:
//   * Use a short duration: SOAK_TOTAL_DURATION=300 (5 min, default) to gate
//     every release candidate without blocking CI for 24 h.
//   * Use a long duration: SOAK_TOTAL_DURATION=86400 for a true overnight soak
//     run manually before a major release.
//
// Usage:
//   node src/scripts/loadtest-soak.js
//   npm run loadtest:soak
//
// Prerequisites:
//   * API running at LOADTEST_URL.
//   * Load-test fixture seeded: `npm run loadtest:seed`.
//
// Configuration (env vars, all optional):
//   LOADTEST_URL             API base URL                  (default http://127.0.0.1:3000)
//   LOADTEST_EMAIL           login email                   (default loadtest@fireisp.local)
//   LOADTEST_PASSWORD        login password                (default loadtest123!)
//   SOAK_TOTAL_DURATION      total soak seconds            (default 300)
//   SOAK_ROUND_DURATION      seconds per autocannon round  (default 30)
//   SOAK_CONNECTIONS         concurrent connections        (default 5)
//   SOAK_MAX_RSS_GROWTH_MB   RSS growth budget in MB       (default 100)
//   SOAK_MAX_ERROR_RATE      max acceptable error fraction (default 0.005  = 0.5%)
// =============================================================================

require('dotenv').config();
const http  = require('http');
const https = require('https');
const { URL } = require('url');
const autocannon = require('autocannon');
const logger = require('../utils/logger').child({ script: 'loadtest-soak' });

const BASE_URL            = (process.env.LOADTEST_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const EMAIL               = process.env.LOADTEST_EMAIL    || 'loadtest@fireisp.local';
const PASSWORD            = process.env.LOADTEST_PASSWORD || 'loadtest123!';
const TOTAL_DURATION      = parseInt(process.env.SOAK_TOTAL_DURATION,     10) || 300;
const ROUND_DURATION      = parseInt(process.env.SOAK_ROUND_DURATION,     10) || 30;
const CONNECTIONS         = parseInt(process.env.SOAK_CONNECTIONS,        10) || 5;
const MAX_RSS_GROWTH_MB   = parseInt(process.env.SOAK_MAX_RSS_GROWTH_MB,  10) || 100;
const MAX_ERROR_RATE      = parseFloat(process.env.SOAK_MAX_ERROR_RATE)       || 0.005;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const lib  = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req  = lib.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          'content-type':   'application/json',
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

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: { accept: 'application/json' },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = { raw }; }
          resolve(parsed);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Autocannon round
// ---------------------------------------------------------------------------

function runRound(scenarios, token) {
  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
    // Run scenarios sequentially within each round, collect per-round totals.
    const roundResults = [];
    let idx = 0;

    function next() {
      if (idx >= scenarios.length) return resolve(roundResults);
      const s = scenarios[idx++];
      const h = s.auth === false ? { accept: 'application/json' } : headers;
      const instance = autocannon(
        {
          url:         BASE_URL + s.path,
          method:      'GET',
          connections: CONNECTIONS,
          duration:    ROUND_DURATION,
          headers:     h,
          title:       s.name,
        },
        (err, result) => {
          if (err) return reject(err);
          roundResults.push({
            name:         s.name,
            reqPerSec:    Math.round(result.requests.average),
            p99:          result.latency.p99,
            errors:       result.errors + result.timeouts,
            non2xx:       result.non2xx,
            totalReqs:    result.requests.total,
            statusCodes:  { '2xx': result['2xx'], '5xx': result['5xx'] },
          });
          next();
        },
      );
      autocannon.track(instance, { renderProgressBar: process.stderr.isTTY });
    }

    next();
  });
}

// ---------------------------------------------------------------------------
// Memory probe — reads RSS from the /health?detail=true endpoint
// ---------------------------------------------------------------------------

async function probeRssMb() {
  try {
    const resp = await getJson(`${BASE_URL}/health?detail=true`);
    if (resp && resp.memory && typeof resp.memory.rss === 'number') {
      return resp.memory.rss; // already in MB
    }
  } catch (_) { /* ignore — metric is advisory */ }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  logger.info(
    { BASE_URL, TOTAL_DURATION, ROUND_DURATION, CONNECTIONS, MAX_RSS_GROWTH_MB, MAX_ERROR_RATE },
    'Starting FireISP P1.6 soak test',
  );

  // Auth
  let loginResp;
  try {
    loginResp = await postJson(`${BASE_URL}/api/v1/auth/login`, { email: EMAIL, password: PASSWORD });
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

  // Scenarios — lightweight mix of baseline + single-record reads + list reads
  const scenarios = [
    { name: 'GET /health (no auth)',           path: '/health',                          auth: false },
    { name: 'GET /clients/1 (single record)',  path: '/api/v1/clients/1' },
    { name: 'GET /clients (list, page 1)',     path: '/api/v1/clients?page=1&limit=50' },
    { name: 'GET /invoices (list, page 1)',    path: '/api/v1/invoices?page=1&limit=50' },
  ];

  const startedAt    = Date.now();
  const baselineRss  = await probeRssMb();
  const roundSummaries = [];
  let   roundNumber  = 0;
  const violations   = [];

  logger.info({ baselineRssMb: baselineRss }, 'Baseline RSS sampled');

  while (Date.now() - startedAt < TOTAL_DURATION * 1000) {
    roundNumber++;
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    logger.info({ round: roundNumber, elapsedSec }, 'Starting soak round');

    const roundResults = await runRound(scenarios, token);

    const rssMb        = await probeRssMb();
    const rssGrowthMb  = (baselineRss !== null && rssMb !== null) ? rssMb - baselineRss : null;
    const roundReqs    = roundResults.reduce((s, r) => s + r.totalReqs, 0);
    const roundErrors  = roundResults.reduce((s, r) => s + r.errors + r.non2xx, 0);
    const errorRate    = roundReqs > 0 ? roundErrors / roundReqs : 0;
    const worstP99     = Math.max(...roundResults.map(r => r.p99 || 0));

    const summary = {
      round:        roundNumber,
      elapsedSec:   Math.round((Date.now() - startedAt) / 1000),
      rssMb,
      rssGrowthMb,
      roundReqs,
      roundErrors,
      errorRate:    +errorRate.toFixed(4),
      worstP99Ms:   worstP99,
    };
    roundSummaries.push(summary);
    logger.info(summary, 'Soak round complete');

    // Budget checks
    if (rssGrowthMb !== null && rssGrowthMb > MAX_RSS_GROWTH_MB) {
      const v = `Round ${roundNumber}: RSS grew ${rssGrowthMb} MB (budget: ${MAX_RSS_GROWTH_MB} MB)`;
      logger.error(v);
      violations.push(v);
    }
    if (errorRate > MAX_ERROR_RATE) {
      const v = `Round ${roundNumber}: error rate ${(errorRate * 100).toFixed(2)}% exceeds budget ${(MAX_ERROR_RATE * 100).toFixed(2)}%`;
      logger.error(v);
      violations.push(v);
    }

    // Stop early on violation — continuing would just accumulate noise.
    if (violations.length > 0) break;
  }

  // Final report
  const totalElapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log('\n=== FireISP P1.6 Soak Test — Summary ===');
  console.log(`  Duration: ${totalElapsed}s / ${TOTAL_DURATION}s  |  Rounds: ${roundNumber}  |  Connections: ${CONNECTIONS}`);
  console.log('');
  console.log('  Round  Elapsed   RSS(MB)  ΔRss(MB)   Reqs    Errors  ErrRate  p99(ms)');
  for (const s of roundSummaries) {
    console.log(
      `  ${String(s.round).padStart(5)}` +
      `  ${String(s.elapsedSec + 's').padStart(7)}` +
      `  ${s.rssMb !== null ? String(s.rssMb).padStart(7) : '    n/a'}` +
      `  ${s.rssGrowthMb !== null ? String(s.rssGrowthMb).padStart(8) : '     n/a'}` +
      `  ${String(s.roundReqs).padStart(6)}` +
      `  ${String(s.roundErrors).padStart(7)}` +
      `  ${String((s.errorRate * 100).toFixed(2) + '%').padStart(7)}` +
      `  ${String(s.worstP99Ms).padStart(7)}`,
    );
  }

  if (violations.length > 0) {
    console.log('\n  VIOLATIONS:');
    for (const v of violations) console.log(`    ✗ ${v}`);
    console.log('');
    process.exit(1);
  }

  console.log('\n  ✓ All soak rounds passed within budget');
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    logger.error({ err: err && err.message, stack: err && err.stack }, 'Soak test crashed');
    process.exit(1);
  });
}

module.exports = { probeRssMb, main };
