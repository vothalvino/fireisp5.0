#!/usr/bin/env node
// =============================================================================
// FireISP 5.0 — OpenAPI Spec Drift Detector (P3.11)
// =============================================================================
// Regenerates the OpenAPI spec in memory and compares it to the committed
// docs/openapi.json.  Exits 1 if any drift is found — meaning either:
//   (a) src/utils/openapi.js was updated but `npm run openapi` was not re-run, or
//   (b) docs/openapi.json was manually edited without updating the generator.
//
// Usage: node src/scripts/spec-drift.js
// CI:    pnpm run spec:check
// =============================================================================

const fs = require('fs');
const path = require('path');

// Load dotenv so the config module resolves without a running server
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { generateSpec } = require('../utils/openapi');

// ---------------------------------------------------------------------------
// Public helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Convert an OpenAPI path pattern (/foo/{id}/bar) to an Express-style path
 * (/foo/:id/bar) for human-readable drift messages.
 * @param {string} p OpenAPI path
 * @returns {string}
 */
function toExpressPath(p) {
  return p.replace(/\{([^}]+)\}/g, ':$1');
}

/**
 * Normalise a spec for comparison by sorting path keys and, within each path,
 * sorting method keys.  JSON serialisation is then deterministic.
 * @param {object} spec Full OpenAPI spec object
 * @returns {object} Normalised spec (deep copy)
 */
function normaliseSpec(spec) {
  const norm = JSON.parse(JSON.stringify(spec));
  if (!norm.paths) return norm;

  const sortedPaths = {};
  for (const p of Object.keys(norm.paths).sort()) {
    const methods = norm.paths[p];
    const sortedMethods = {};
    for (const m of Object.keys(methods).sort()) {
      sortedMethods[m] = methods[m];
    }
    sortedPaths[p] = sortedMethods;
  }
  norm.paths = sortedPaths;
  return norm;
}

/**
 * Find all duplicate operationIds in a spec.  Duplicates break client-code
 * generators and Swagger UI.
 * @param {object} spec Full OpenAPI spec object
 * @returns {string[]} List of duplicated operationId values
 */
function findDuplicateOperationIds(spec) {
  const seen = new Set();
  const dupes = [];
  for (const methods of Object.values(spec.paths || {})) {
    for (const op of Object.values(methods)) {
      if (op && typeof op === 'object' && op.operationId) {
        if (seen.has(op.operationId)) {
          if (!dupes.includes(op.operationId)) dupes.push(op.operationId);
        } else {
          seen.add(op.operationId);
        }
      }
    }
  }
  return dupes;
}

/**
 * Compare two OpenAPI spec objects and return path/method-level differences.
 *
 * @param {object} generated  Spec produced by generateSpec()
 * @param {object} committed  Spec read from docs/openapi.json
 * @returns {{
 *   missingPaths: string[],   paths in generated but absent from committed
 *   extraPaths:   string[],   paths in committed but absent from generated
 *   missingMethods: {path: string, method: string}[],
 *   extraMethods:   {path: string, method: string}[],
 * }}
 */
function findPathDrift(generated, committed) {
  const genPaths = new Set(Object.keys(generated.paths || {}));
  const comPaths = new Set(Object.keys(committed.paths || {}));

  const missingPaths = [...genPaths].filter(p => !comPaths.has(p));
  const extraPaths   = [...comPaths].filter(p => !genPaths.has(p));

  const missingMethods = [];
  const extraMethods   = [];

  for (const p of genPaths) {
    if (!comPaths.has(p)) continue;
    const genMethods = new Set(Object.keys(generated.paths[p]));
    const comMethods = new Set(Object.keys(committed.paths[p]));
    for (const m of genMethods) {
      if (!comMethods.has(m)) missingMethods.push({ path: p, method: m });
    }
    for (const m of comMethods) {
      if (!genMethods.has(m)) extraMethods.push({ path: p, method: m });
    }
  }

  return { missingPaths, extraPaths, missingMethods, extraMethods };
}

/**
 * Deep-equal check for the full spec (paths + info + servers + components).
 * Returns a human-readable list of top-level section mismatches if any are
 * found outside the `paths` block (e.g., a changed info.version or a new
 * component schema that wasn't committed).
 *
 * @param {object} generated
 * @param {object} committed
 * @returns {string[]} List of mismatch messages (empty = clean)
 */
function findMetaDrift(generated, committed) {
  const diffs = [];
  for (const section of ['info', 'servers', 'components']) {
    const genStr = JSON.stringify((generated[section] || {}));
    const comStr = JSON.stringify((committed[section] || {}));
    if (genStr !== comStr) diffs.push(section);
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Main — only runs when executed directly
// ---------------------------------------------------------------------------

/* istanbul ignore next */
if (require.main === module) {
  const specPath = path.resolve(__dirname, '../../docs/openapi.json');

  if (!fs.existsSync(specPath)) {
    console.error('✗  docs/openapi.json not found — run `pnpm run openapi` first.');
    process.exit(1);
  }

  let committed;
  try {
    committed = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (err) {
    console.error(`✗  Failed to parse docs/openapi.json: ${err.message}`);
    process.exit(1);
  }

  let generated;
  try {
    generated = generateSpec();
  } catch (err) {
    console.error(`✗  generateSpec() threw: ${err.message}`);
    process.exit(1);
  }

  let driftFound = false;

  // 1. Duplicate operationIds (generator is the authority)
  const dupes = findDuplicateOperationIds(generated);
  if (dupes.length > 0) {
    console.error('✗  Duplicate operationIds in generated spec:');
    dupes.forEach(id => console.error(`     ${id}`));
    driftFound = true;
  }

  // 2. Path / method drift
  const { missingPaths, extraPaths, missingMethods, extraMethods } = findPathDrift(generated, committed);

  if (missingPaths.length > 0) {
    console.error('\n✗  Paths in generator (src/utils/openapi.js) missing from docs/openapi.json:');
    console.error('   Run `pnpm run openapi` to regenerate the spec.\n');
    missingPaths.forEach(p => console.error(`     ${toExpressPath(p)}`));
    driftFound = true;
  }

  if (extraPaths.length > 0) {
    console.error('\n✗  Paths in docs/openapi.json not present in generator (src/utils/openapi.js):');
    console.error('   Either add them to the generator or remove them from the JSON.\n');
    extraPaths.forEach(p => console.error(`     ${toExpressPath(p)}`));
    driftFound = true;
  }

  if (missingMethods.length > 0) {
    console.error('\n✗  HTTP methods defined in generator but missing from docs/openapi.json:');
    missingMethods.forEach(({ path: p, method: m }) => console.error(`     ${m.toUpperCase()} ${toExpressPath(p)}`));
    driftFound = true;
  }

  if (extraMethods.length > 0) {
    console.error('\n✗  HTTP methods in docs/openapi.json not present in generator:');
    extraMethods.forEach(({ path: p, method: m }) => console.error(`     ${m.toUpperCase()} ${toExpressPath(p)}`));
    driftFound = true;
  }

  // 3. Meta section drift (info / servers / components)
  const metaDiffs = findMetaDrift(generated, committed);
  if (metaDiffs.length > 0) {
    console.error(`\n✗  Spec sections differ between generator and docs/openapi.json: ${metaDiffs.join(', ')}`);
    console.error('   Run `pnpm run openapi` to regenerate the spec.\n');
    driftFound = true;
  }

  if (driftFound) {
    process.exit(1);
  }

  const pathCount = Object.keys(generated.paths || {}).length;
  console.log(`✓  docs/openapi.json is in sync with src/utils/openapi.js (${pathCount} paths, 0 drift items)`);
  process.exit(0);
}

module.exports = { toExpressPath, normaliseSpec, findDuplicateOperationIds, findPathDrift, findMetaDrift };
