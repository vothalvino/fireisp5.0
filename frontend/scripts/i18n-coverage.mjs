#!/usr/bin/env node
// =============================================================================
// FireISP 5.0 — i18n message catalogue coverage checker
// =============================================================================
// Verifies that every key present in the English base catalogue (en.json) also
// exists in every other supported locale (es.json, pt-BR.json).
//
// Exit codes:
//   0 — all locales are complete
//   1 — one or more keys are missing in a non-English locale
//
// Usage:
//   node scripts/i18n-coverage.mjs
//   npm run i18n:check
// =============================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/i18n/locales');

const LOCALES = ['es', 'pt-BR'];
const BASE_LOCALE = 'en';

/**
 * Flatten a nested object into dot-separated keys.
 * e.g. { a: { b: 'v' } } → { 'a.b': 'v' }
 */
function flatten(obj, prefix = '') {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(acc, flatten(value, full));
    } else {
      acc[full] = value;
    }
    return acc;
  }, {});
}

function loadLocale(locale) {
  const path = join(LOCALES_DIR, `${locale}.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function run() {
  const base = flatten(loadLocale(BASE_LOCALE));
  const baseKeys = Object.keys(base);

  let totalMissing = 0;

  console.log(`\ni18n coverage check — base locale: ${BASE_LOCALE} (${baseKeys.length} keys)\n`);

  for (const locale of LOCALES) {
    const target = flatten(loadLocale(locale));
    const missing = baseKeys.filter(k => !(k in target));
    const extra   = Object.keys(target).filter(k => !(k in base));

    const pct = (((baseKeys.length - missing.length) / baseKeys.length) * 100).toFixed(1);

    if (missing.length === 0) {
      console.log(`  ✅  ${locale.padEnd(8)} — ${baseKeys.length}/${baseKeys.length} keys (100%)`);
    } else {
      console.log(`  ❌  ${locale.padEnd(8)} — ${baseKeys.length - missing.length}/${baseKeys.length} keys (${pct}%) — ${missing.length} missing:`);
      for (const k of missing) {
        console.log(`       missing: ${k}`);
      }
      totalMissing += missing.length;
    }

    if (extra.length > 0) {
      console.log(`       ⚠️  ${extra.length} extra key(s) not in ${BASE_LOCALE} (orphaned translations):`);
      for (const k of extra) {
        console.log(`       extra: ${k}`);
      }
    }
  }

  console.log('');

  if (totalMissing > 0) {
    console.error(`i18n coverage FAILED — ${totalMissing} key(s) missing across all non-English locales.\n`);
    process.exit(1);
  }

  console.log(`i18n coverage PASSED — all ${LOCALES.length} non-English locales are complete.\n`);
}

run();
