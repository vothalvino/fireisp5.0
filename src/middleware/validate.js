// =============================================================================
// FireISP 5.0 — Input Validation Middleware
// =============================================================================

const { ValidationError } = require('../utils/errors');

/**
 * Returns middleware that validates req.body against a Joi-like schema object.
 * Simple field-level validation without external dependencies.
 *
 * Schema format: { fieldName: { type, required, min, max, enum, pattern } }
 *
 * @param {object} schema   field rules
 * @param {object} [options]
 * @param {boolean} [options.strip]  when true, delete any req.body key that is
 *   not declared in the schema. This is the mass-assignment guard for sensitive
 *   mutation routes: privileged columns (e.g. role, user_id, organization_id)
 *   can never reach a fillable-filtered model from an untrusted request body.
 *   Off by default so routes that intentionally read undeclared optional fields
 *   are unaffected.
 */
function validate(schema, options = {}) {
  return (req, _res, next) => {
    const errors = [];
    const body = req.body || {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field];

      // Required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push({ field, message: `${field} is required` });
        continue;
      }

      // Skip optional missing fields
      if (value === undefined || value === null) continue;

      // Type check
      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push({ field, message: `${field} must be a string` });
      } else if (rules.type === 'number' && typeof value !== 'number') {
        errors.push({ field, message: `${field} must be a number` });
      } else if (rules.type === 'boolean' && typeof value !== 'boolean') {
        errors.push({ field, message: `${field} must be a boolean` });
      } else if (rules.type === 'array' && !Array.isArray(value)) {
        errors.push({ field, message: `${field} must be an array` });
      } else if (rules.type === 'email' && typeof value === 'string') {
        // Simple, ReDoS-safe email validation: local@domain.tld
        if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value)) {
          errors.push({ field, message: `${field} must be a valid email` });
        }
      }

      // Enum check
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field, message: `${field} must be one of: ${rules.enum.join(', ')}` });
      }

      // Min / max for strings
      if (rules.min !== undefined && typeof value === 'string' && value.length < rules.min) {
        errors.push({ field, message: `${field} must be at least ${rules.min} characters` });
      }
      if (rules.max !== undefined && typeof value === 'string' && value.length > rules.max) {
        errors.push({ field, message: `${field} must be at most ${rules.max} characters` });
      }

      // Min / max for numbers
      if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
        errors.push({ field, message: `${field} must be at least ${rules.min}` });
      }
      if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
        errors.push({ field, message: `${field} must be at most ${rules.max}` });
      }

      // Pattern check
      if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
        errors.push({ field, message: `${field} has an invalid format` });
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError('Validation failed', errors));
    }

    // Mass-assignment guard (opt-in): strip any key not declared in the schema.
    if (options.strip && body && typeof body === 'object') {
      for (const key of Object.keys(body)) {
        if (!Object.prototype.hasOwnProperty.call(schema, key)) {
          delete body[key];
        }
      }
    }

    next();
  };
}

module.exports = { validate };
