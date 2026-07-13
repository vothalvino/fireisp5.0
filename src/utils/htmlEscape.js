// =============================================================================
// FireISP 5.0 — HTML escaping helper
// =============================================================================
// Small, dependency-free HTML-entity escaper for interpolating untrusted
// strings into server-rendered HTML (currently: outbound transactional email
// bodies built in src/views/emailTemplates.js). Lives in its own module —
// deliberately NOT src/middleware/sanitize.js's request-body sanitizer —
// because this is output encoding at the point a value is written into HTML,
// not input validation on the way into the app. It must keep working
// regardless of what request-level sanitization does or does not run.
// =============================================================================

/**
 * Replace HTML-significant characters with safe entities.
 * Same 5-entity encoding used platform-wide: & < > " '
 *
 * @param {*} value  Coerced to a string before escaping (so callers can pass
 *                    a possibly-undefined/non-string field without crashing).
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

module.exports = { escapeHtml };
