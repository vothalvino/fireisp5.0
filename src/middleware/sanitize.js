// =============================================================================
// FireISP 5.0 — Input Sanitization Middleware
// =============================================================================
// Recursively sanitizes string values in req.body to prevent stored XSS.
// Replaces dangerous HTML characters with their entity equivalents.
// Runs after body parsing and before validation/route handlers.
// =============================================================================

/**
 * Replace HTML-significant characters with safe entities.
 * Prevents stored XSS when user-submitted content is rendered.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Recursively sanitize all string values in an object or array.
 */
function sanitizeValue(value) {
  if (typeof value === 'string') {
    return escapeHtml(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value);
  }
  return value;
}

/**
 * Sanitize all string properties in a plain object.
 */
function sanitizeObject(obj) {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

/**
 * Express middleware that sanitizes req.body string fields.
 * Preserves non-string types (numbers, booleans, nulls) untouched.
 *
 * Note: GraphQL requests are excluded because the GraphQL engine performs its
 * own query parsing and validation, and HTML-encoding query strings breaks
 * the GraphQL parser (e.g. `"10"` becomes `&quot;10&quot;`).
 */
function sanitize(req, _res, next) {
  if (req.path?.endsWith('/graphql')) {
    return next();
  }
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

module.exports = { sanitize, escapeHtml, sanitizeValue, sanitizeObject };
