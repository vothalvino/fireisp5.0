// =============================================================================
// FireISP 5.0 — Docker Volume Persistence Verifier
// =============================================================================
// Inspects a running Docker container and reports whether its critical data
// directories (MySQL data, Redis AOF, app storage, Chroma) are backed by a
// persistent mount (named volume or host bind) or live in the container's
// ephemeral writable layer — where they would be lost on `docker rm`.
//
// This is the automated half of the "Verification & Migration Protocol":
//   • Exit 0  → all critical paths are SAFE (persistent). Proceed to update.
//   • Exit 1  → at least one critical path is EPHEMERAL. Back up and migrate
//               to a named volume before recreating the container.
//   • Exit 2  → could not inspect the container (Docker missing / wrong name).
//
// Usage:  node src/scripts/verify-volumes.js <container> [target ...]
//         npm run verify:volumes -- fireisp-db-1
//
// When no targets are given, the MySQL data directory (/var/lib/mysql) is
// checked by default. Pass extra targets to check Redis (/data), app storage
// (/app/storage), or Chroma (/chroma/chroma).
//
// Requires: the `docker` CLI available in PATH with access to the daemon.
// =============================================================================

const { execFileSync } = require('child_process');
const logger = require('../utils/logger').child({ script: 'verify-volumes' });

// Mount types that survive `docker rm` (data lives outside the writable layer).
const PERSISTENT_TYPES = new Set(['volume', 'bind']);

// Default critical path checked when the caller does not specify any.
const DEFAULT_TARGETS = ['/var/lib/mysql'];

/**
 * Classify a container's mounts against a set of critical destination paths.
 *
 * @param {Array<{Type:string,Name?:string,Source?:string,Destination:string}>} mounts
 *        The `.Mounts` array from `docker inspect`.
 * @param {string[]} targets Container paths that must be persistent.
 * @returns {Array<{target:string,persistent:boolean,type:string|null,source:string|null}>}
 *          One result per target, in the order given.
 */
function classifyMounts(mounts, targets) {
  const list = Array.isArray(mounts) ? mounts : [];
  return targets.map((target) => {
    const mount = list.find((m) => m && m.Destination === target);
    if (!mount) {
      // No mount covers this path → data is in the ephemeral writable layer.
      return { target, persistent: false, type: null, source: null };
    }
    return {
      target,
      persistent: PERSISTENT_TYPES.has(mount.Type),
      type: mount.Type || null,
      source: mount.Name || mount.Source || null,
    };
  });
}

/**
 * Run `docker inspect` for a container and return its `.Mounts` array.
 * Uses execFileSync (no shell) so the container name is never interpolated
 * into a shell command.
 *
 * @param {string} container Container name or id.
 * @returns {Array} The Mounts array (empty if the container has no mounts).
 */
function inspectMounts(container) {
  const out = execFileSync(
    'docker',
    ['inspect', '--format', '{{json .Mounts}}', container],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out.trim() || '[]');
}

/**
 * Verify the given container's critical paths.
 *
 * @param {string} container Container name or id.
 * @param {string[]} [targets] Critical paths (defaults to DEFAULT_TARGETS).
 * @returns {{container:string,safe:boolean,results:Array}}
 */
function verify(container, targets = DEFAULT_TARGETS) {
  const mounts = inspectMounts(container);
  const results = classifyMounts(mounts, targets);
  const safe = results.every((r) => r.persistent);
  return { container, safe, results };
}

// Run when invoked directly.
if (require.main === module) {
  const [, , container, ...targets] = process.argv;

  if (!container) {
    logger.error('Usage: node src/scripts/verify-volumes.js <container> [target ...]');
    process.exit(2);
  }

  const checkTargets = targets.length > 0 ? targets : DEFAULT_TARGETS;

  let report;
  try {
    report = verify(container, checkTargets);
  } catch (err) {
    logger.error({ err: err.message, container }, 'Unable to inspect container');
    process.exit(2);
  }

  for (const r of report.results) {
    if (r.persistent) {
      logger.info({ target: r.target, type: r.type, source: r.source }, 'SAFE — persistent mount');
    } else {
      logger.warn(
        { target: r.target, type: r.type || 'none' },
        'EPHEMERAL — data is in the container writable layer and will be lost on docker rm',
      );
    }
  }

  if (report.safe) {
    logger.info({ container }, 'All critical paths are persistent — safe to update.');
    process.exit(0);
  }

  logger.error(
    { container },
    'One or more critical paths are ephemeral — back up and migrate to a named volume before recreating.',
  );
  process.exit(1);
}

module.exports = { classifyMounts, inspectMounts, verify, DEFAULT_TARGETS, PERSISTENT_TYPES };
