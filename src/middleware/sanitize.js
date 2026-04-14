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
 */
function sanitize(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }
  next();
}

/**
 * Validate that :id route parameters are positive integers.
 */
function validateIdParam(req, res, next) {
  if (req.params.id !== undefined) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: { code: 'INVALID_PARAMETER', message: 'ID must be a positive integer' },
      });
    }
  }
  next();
}

module.exports = { sanitize, escapeHtml, sanitizeValue, sanitizeObject, validateIdParam };
