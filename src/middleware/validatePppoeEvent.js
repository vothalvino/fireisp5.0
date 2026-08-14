// =============================================================================
// FireISP 5.0 — PPPoE event-ingest validation
// =============================================================================

const { ValidationError } = require('../utils/errors');

const STAGES = Object.freeze([
  'PADI', 'PADO', 'PADR', 'PADS', 'PADT', 'LCP', 'IPCP', 'IPV6CP', 'AUTH', 'OTHER',
]);
const SEVERITIES = Object.freeze(['info', 'warning', 'error']);

const RAW_KEYS = new Set(['nas_id', 'line', 'logged_at']);
const STRUCTURED_KEYS = new Set([
  'nas_id', 'message', 'stage', 'severity', 'reason_code', 'username', 'mac', 'logged_at',
]);

// ISO-8601 (with a required time) or the MySQL DATETIME spelling commonly
// emitted by syslog shippers. Date.parse() alone is deliberately not used as
// validation because it accepts implementation-specific inputs such as bare
// integers and locale-dependent dates.
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$/;
const MAC_RE = /^(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
const REASON_CODE_RE = /^[A-Za-z0-9_.:-]+$/;

function canonicalizeMac(mac) {
  return mac.replace(/-/g, ':').toUpperCase();
}

function addError(errors, field, message) {
  errors.push({ field, message });
}

function parseLoggedAt(value) {
  if (typeof value !== 'string' || !DATE_TIME_RE.test(value)) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  // Date normalisation must not turn invalid calendar/time components (for
  // example February 31 or hour 29) into a different valid timestamp.
  const components = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!components) return null;
  const [, year, month, day, hour, minute, second] = components.map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDay) return null;
  return parsed;
}

/**
 * Strictly validate one PPPoE ingest payload.
 *
 * Accepted shapes are intentionally disjoint:
 *   raw        { nas_id, line, logged_at? }
 *   structured { nas_id, message, stage?, severity?, reason_code?, username?, mac?, logged_at? }
 *
 * Unknown keys are rejected (rather than silently stripped), most importantly
 * organization_id: tenant ownership is always derived from the NAS row.
 */
function validatePppoeEvent(req, _res, next) {
  const body = req.body;
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return next(new ValidationError('Validation failed', [
      { field: 'body', message: 'body must be a JSON object' },
    ]));
  }

  const hasLine = Object.prototype.hasOwnProperty.call(body, 'line');
  const hasMessage = Object.prototype.hasOwnProperty.call(body, 'message');
  if (hasLine === hasMessage) {
    addError(errors, 'line', 'provide exactly one of line or message');
  }

  const allowedKeys = hasLine && !hasMessage ? RAW_KEYS : STRUCTURED_KEYS;
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) addError(errors, key, `${key} is not allowed`);
  }

  if (!Number.isSafeInteger(body.nas_id) || body.nas_id <= 0) {
    addError(errors, 'nas_id', 'nas_id must be a positive integer');
  }

  const textField = hasLine ? 'line' : 'message';
  const text = body[textField];
  if (typeof text !== 'string' || text.trim().length === 0) {
    addError(errors, textField, `${textField} must be a non-empty string`);
  } else if (text.length > 8192) {
    addError(errors, textField, `${textField} must be at most 8192 characters`);
  }

  if (body.stage !== undefined && !STAGES.includes(body.stage)) {
    addError(errors, 'stage', `stage must be one of: ${STAGES.join(', ')}`);
  }
  if (body.severity !== undefined && !SEVERITIES.includes(body.severity)) {
    addError(errors, 'severity', `severity must be one of: ${SEVERITIES.join(', ')}`);
  }

  if (body.reason_code !== undefined) {
    if (typeof body.reason_code !== 'string' || body.reason_code.length < 1
        || body.reason_code.length > 50 || !REASON_CODE_RE.test(body.reason_code)) {
      addError(errors, 'reason_code', 'reason_code must be 1-50 letters, digits, dots, colons, underscores, or hyphens');
    }
  }

  if (body.username !== undefined
      && (typeof body.username !== 'string' || body.username.trim().length < 1
        || body.username.length > 64)) {
    addError(errors, 'username', 'username must be a non-empty string of at most 64 characters');
  }

  if (body.mac !== undefined && (typeof body.mac !== 'string' || !MAC_RE.test(body.mac))) {
    addError(errors, 'mac', 'mac must be a six-octet colon- or hyphen-separated address');
  }

  if (body.logged_at !== undefined) {
    const parsed = parseLoggedAt(body.logged_at);
    if (!parsed) {
      addError(errors, 'logged_at', 'logged_at must be a valid ISO-8601 datetime');
    } else {
      body.logged_at = parsed;
    }
  }

  if (errors.length) return next(new ValidationError('Validation failed', errors));

  body[textField] = text.trim();
  if (body.username !== undefined) body.username = body.username.trim();
  if (body.mac !== undefined) body.mac = canonicalizeMac(body.mac);
  next();
}

module.exports = {
  STAGES,
  SEVERITIES,
  canonicalizeMac,
  parseLoggedAt,
  validatePppoeEvent,
};
