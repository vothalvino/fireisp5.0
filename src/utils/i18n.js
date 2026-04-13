// =============================================================================
// FireISP 5.0 — Internationalization (i18n) Utility
// =============================================================================
// Lightweight translation layer. Loads locale JSON files from src/locales/.
// Usage:
//   const { t } = require('./utils/i18n');
//   t('errors.not_found', 'es')     // "Recurso no encontrado"
//   t('errors.not_found')           // "Resource not found" (default 'en')
// =============================================================================

const fs = require('fs');
const path = require('path');

const localesDir = path.resolve(__dirname, '../locales');
const loaded = {};

/**
 * Load a locale file into the cache.
 * Locale files are at src/locales/{locale}.json.
 */
function loadLocale(locale) {
  if (loaded[locale]) return loaded[locale];

  const filePath = path.join(localesDir, `${locale}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    loaded[locale] = data;
    return data;
  } catch (_err) {
    return null;
  }
}

/**
 * Translate a dot-delimited key in the given locale.
 * Falls back to English ('en') if the key is not found in the target locale.
 * Falls back to the key itself if not found in any locale.
 *
 * @param {string} key    Dot-delimited key, e.g. 'errors.not_found'
 * @param {string} locale ISO 639-1 language code (default 'en')
 * @param {object} vars   Optional replacement map: { name: 'John' } replaces {{name}}
 * @returns {string}
 */
function t(key, locale = 'en', vars = {}) {
  // Try target locale first
  let value = resolve(loadLocale(locale), key);

  // Fallback to English
  if (value === undefined && locale !== 'en') {
    value = resolve(loadLocale('en'), key);
  }

  // Final fallback: return the key itself
  if (value === undefined) return key;

  // Replace {{var}} placeholders
  if (vars && typeof value === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
  }

  return value;
}

/**
 * Resolve a dot-delimited key in a nested object.
 */
function resolve(obj, key) {
  if (!obj || !key) return undefined;
  const parts = key.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Return all available locale codes.
 */
function availableLocales() {
  try {
    return fs.readdirSync(localesDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch (_err) {
    return ['en'];
  }
}

module.exports = { t, loadLocale, availableLocales };
