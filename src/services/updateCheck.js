// =============================================================================
// FireISP 5.0 — is a newer release available?
// =============================================================================
// Answers two separate questions, and keeps them separate on purpose:
//
//   1. What commit is this instance running?  — always known, no network.
//   2. Is there a newer one?                  — needs an outbound call, and is
//                                               OFF unless an operator opts in.
//
// WHY OPT-IN. FireISP is self-hosted by other people. A billing and network
// management system that silently calls github.com every day is the kind of
// thing that fails a customer's security review, and an air-gapped or
// management-network install would log a failed request forever with no way to
// stop it. So the default is off and the request carries no install data.
//
// WHY AN ENV VAR AND NOT THE `settings` TABLE. That was the first design, and
// it is wrong here. `settings` is install-wide (no organization_id) but is
// written through PUT /settings/:key, which any org admin holds — verified on a
// live install: org A writes a key and org B reads the change. Storing the
// opt-in there would let any tenant switch on an outbound call the operator
// deliberately declined. An env var can only be set by whoever edits
// .env.prod — which is exactly, and only, the install operator this feature is
// for. (The `settings` cross-tenant write is filed separately; this feature
// simply must not be built on top of it.)
//
// WHAT IT SENDS. An unauthenticated GET to the public GitHub commits API. No
// identifiers, no version, no telemetry — the request body is empty and the
// response tells us the newest commit on main. GitHub's unauthenticated limit
// is 60/hour per IP, and this runs at most once per CHECK_TTL_MS, so a busy
// install cannot approach it.
// =============================================================================

const logger = require('../utils/logger').child({ service: 'updateCheck' });

const ENV_FLAG = 'FIREISP_UPDATE_CHECK';
const REPO = process.env.FIREISP_UPDATE_REPO || 'vothalvino/fireisp5.0';
const API = `https://api.github.com/repos/${REPO}/commits/main`;

// One check per day. The banner is a nudge, not a monitor: checking more often
// spends someone else's rate limit to tell them the same thing.
const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

// Process-local. A restart re-checks, which is fine and self-limiting; putting
// this in the database would mean a write on a read path for a cosmetic banner.
let cache = { at: 0, latestSha: null, error: null };

/**
 * The commit this image was built from, or null when it was not built by CI.
 *
 * Baked in by the Dockerfile (ARG GIT_SHA -> ENV FIREISP_GIT_SHA). Empty for a
 * local docker-compose.build.yml image, and null is reported honestly rather
 * than guessed: package.json's "5.0.0" is static and has never moved, and the
 * host's git checkout describes the SOURCE, which disagrees with the image
 * exactly when someone has rolled back.
 */
function runningSha() {
  const sha = (process.env.FIREISP_GIT_SHA || '').trim();
  return sha.length ? sha : null;
}

/**
 * Whether the operator has opted in to the outbound check.
 *
 * Unset = off. An install that never touches this makes no network calls at
 * all, which is the behaviour every existing install already has.
 */
function isEnabled() {
  const raw = String(process.env[ENV_FLAG] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Newest commit on main, or null. Cached for CHECK_TTL_MS including failures,
 * so an install with no egress retries once a day rather than on every page
 * load.
 */
async function fetchLatestSha() {
  const fresh = Date.now() - cache.at < CHECK_TTL_MS;
  if (fresh && (cache.latestSha || cache.error)) return cache.latestSha;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub requires a User-Agent. It names the product, never the install.
        'User-Agent': 'FireISP-update-check',
      },
    });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const body = await res.json();
    const sha = typeof body?.sha === 'string' ? body.sha : null;
    cache = { at: Date.now(), latestSha: sha, error: null };
    return sha;
  } catch (err) {
    // Never throws to the caller: an unreachable github.com must not break the
    // page that asked. Cached as an error so it is not retried per request.
    cache = { at: Date.now(), latestSha: null, error: err.message };
    logger.info({ err: err.message }, 'Update check could not reach GitHub');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Status for the UI.
 *
 * update_available is only ever true when BOTH shas are known and differ. An
 * unknown running sha (locally built image) reports enabled/checked state
 * honestly and update_available false — claiming an update exists when we
 * cannot tell what is running would send someone to redeploy for no reason.
 */
async function getStatus() {
  const running = runningSha();
  if (!isEnabled()) {
    return {
      running_sha: running,
      latest_sha: null,
      update_available: false,
      check_enabled: false,
      checked_at: null,
    };
  }

  const latest = await fetchLatestSha();
  return {
    running_sha: running,
    latest_sha: latest,
    update_available: Boolean(running && latest && running !== latest),
    check_enabled: true,
    checked_at: cache.at ? new Date(cache.at).toISOString() : null,
  };
}

/** Test seam — the module-level cache would otherwise leak between cases. */
function _resetCache() {
  cache = { at: 0, latestSha: null, error: null };
}

module.exports = { getStatus, runningSha, isEnabled, ENV_FLAG, _resetCache };
