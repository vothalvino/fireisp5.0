// =============================================================================
// FireISP 5.0 — Security Admin Routes (§17)
// Covers: webauthn_credentials, admin_ip_allowlist, password_policies,
//         api_key_rate_limits
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createWebAuthn,
  updatePasswordPolicy,
  createAdminIpAllowlist,
} = require('../middleware/schemas/security');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { parseEntry, isAllowed } = require('../middleware/ipAllowlist');
const {
  clientIp,
  environmentOverrideConfigured,
  getAdminIpAllowlistStatus,
  listActiveEntries,
} = require('../middleware/adminIpAllowlist');

const router = Router();

function requireInteractiveJwt(req, _res, next) {
  if (req.user?.apiTokenId) {
    return next(new ForbiddenError('API token rate-policy changes require an interactive user session'));
  }
  return next();
}

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// WebAuthn Credentials
// ---------------------------------------------------------------------------

// GET /webauthn — list WebAuthn credentials for current user
router.get('/webauthn', requirePermission('webauthn.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM webauthn_credentials WHERE organization_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY id DESC',
      [req.orgId, req.user.id],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /webauthn — register WebAuthn credential
router.post('/webauthn', requirePermission('webauthn.create'), validate(createWebAuthn), async (req, res, next) => {
  try {
    const { credential_id, public_key, friendly_name, aaguid, transports } = req.body;
    const [result] = await db.query(
      `INSERT INTO webauthn_credentials
        (organization_id, user_id, credential_id, public_key, friendly_name, aaguid, transports)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.orgId,
        req.user.id,
        credential_id,
        public_key,
        friendly_name || null,
        aaguid || null,
        transports ? JSON.stringify(transports) : null,
      ],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// DELETE /webauthn/:id — revoke WebAuthn credential
router.delete('/webauthn/:id', requirePermission('webauthn.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE webauthn_credentials SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND user_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId, req.user.id],
    );
    if (result.affectedRows === 0) throw new NotFoundError('WebAuthn credential');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Admin IP Allowlist
// ---------------------------------------------------------------------------

function validatedCidr(value) {
  const cidr = typeof value === 'string' ? value.trim() : '';
  if (!cidr || !parseEntry(cidr)) {
    throw new ValidationError('Enter a valid IPv4 address or CIDR range', [
      { field: 'cidr', message: 'Use an IPv4 address such as 203.0.113.5 or CIDR such as 203.0.113.0/24' },
    ]);
  }
  return cidr;
}

async function assertCurrentIpRemainsAllowed(req, candidateEntries) {
  // The environment override takes precedence, so database edits cannot alter
  // the policy currently protecting the request.
  if (environmentOverrideConfigured() || candidateEntries.length === 0) return;
  const parsed = candidateEntries.map(entry => parseEntry(entry.cidr)).filter(Boolean);
  if (parsed.length > 0 && isAllowed(clientIp(req), parsed)) return;
  throw new ValidationError(
    'Activation refused because the resulting allowlist would exclude your current IP address',
    [{ field: 'is_active', message: 'Add the current IP shown in the allowlist status before activating this policy' }],
  );
}

// GET /admin-ip-allowlist/status — setup state used by the persistent GUI warning
router.get('/admin-ip-allowlist/status', requirePermission('admin_ip_allowlist.view'), async (req, res, next) => {
  try {
    const status = await getAdminIpAllowlistStatus(req.orgId, clientIp(req));
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

// GET /admin-ip-allowlist — list org admin IP allowlist
router.get('/admin-ip-allowlist', requirePermission('admin_ip_allowlist.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM admin_ip_allowlist WHERE organization_id = ? AND deleted_at IS NULL ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /admin-ip-allowlist — add entry
// Accepts `cidr` (new schema name) or legacy `ip_address` for backward compat.
router.post('/admin-ip-allowlist', requirePermission('admin_ip_allowlist.create'), validate(createAdminIpAllowlist), async (req, res, next) => {
  try {
    const { cidr, ip_address, description, is_active } = req.body;
    const rawCidr = cidr ?? ip_address;
    if (!rawCidr) {
      throw new ValidationError('Validation failed', [{ field: 'cidr', message: 'cidr (or ip_address) is required' }]);
    }
    const cidrValue = validatedCidr(rawCidr);
    const activate = is_active === true;
    if (activate) {
      const activeEntries = await listActiveEntries(req.orgId);
      await assertCurrentIpRemainsAllowed(req, [...activeEntries, { cidr: cidrValue }]);
    }
    const [result] = await db.query(
      `INSERT INTO admin_ip_allowlist (organization_id, cidr, description, is_active, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      // New rules are staged inactive unless the user explicitly activates.
      [req.orgId, cidrValue, description || null, activate ? 1 : 0, req.user.id],
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// PUT /admin-ip-allowlist/:id — update entry
// Accepts `cidr` (new schema name) or legacy `ip_address` for backward compat.
router.put('/admin-ip-allowlist/:id', requirePermission('admin_ip_allowlist.update'), async (req, res, next) => {
  try {
    const { cidr, ip_address, description, is_active } = req.body;
    const [[current]] = await db.query(
      `SELECT id, organization_id, cidr, description, is_active
       FROM admin_ip_allowlist
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (!current) throw new NotFoundError('Admin IP allowlist entry');

    const rawCidr = cidr ?? ip_address;
    const cidrValue = rawCidr !== undefined ? validatedCidr(rawCidr) : current.cidr;
    const activate = is_active !== undefined ? is_active === true : Boolean(current.is_active);
    const activeEntries = await listActiveEntries(req.orgId);
    const candidateEntries = activeEntries.filter(entry => Number(entry.id) !== Number(current.id));
    if (activate) candidateEntries.push({ ...current, cidr: cidrValue, is_active: 1 });
    await assertCurrentIpRemainsAllowed(req, candidateEntries);

    const [result] = await db.query(
      `UPDATE admin_ip_allowlist
       SET cidr = COALESCE(?, cidr),
           description = ?,
           is_active = COALESCE(?, is_active),
           updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [cidrValue, description !== undefined ? description : current.description, activate ? 1 : 0, req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('Admin IP allowlist entry');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin-ip-allowlist/:id — delete entry
router.delete('/admin-ip-allowlist/:id', requirePermission('admin_ip_allowlist.delete'), async (req, res, next) => {
  try {
    const activeEntries = await listActiveEntries(req.orgId);
    const candidateEntries = activeEntries.filter(entry => Number(entry.id) !== Number(req.params.id));
    await assertCurrentIpRemainsAllowed(req, candidateEntries);
    const [result] = await db.query(
      'DELETE FROM admin_ip_allowlist WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('Admin IP allowlist entry');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Password Policy
// ---------------------------------------------------------------------------

// GET /password-policy — get org password policy
router.get('/password-policy', requirePermission('password_policy.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT * FROM password_policies WHERE organization_id = ? LIMIT 1',
      [req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'No password policy configured' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// PUT /password-policy — update org password policy (upsert by org)
router.put('/password-policy', requirePermission('password_policy.update'), validate(updatePasswordPolicy), async (req, res, next) => {
  try {
    const {
      min_length,
      require_uppercase,
      require_lowercase,
      require_digits,
      require_special_chars,
      // Accept legacy require_symbols as alias for require_special_chars
      require_symbols,
      max_repeated_chars,
      rotation_days,
      history_count,
      lockout_attempts,
      lockout_duration_minutes,
    } = req.body;

    const specialChars = require_special_chars !== undefined ? require_special_chars : require_symbols;

    await db.query(
      `INSERT INTO password_policies
        (organization_id, min_length, require_uppercase, require_lowercase, require_digits, require_special_chars, max_repeated_chars, rotation_days, history_count, lockout_attempts, lockout_duration_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         min_length = VALUES(min_length),
         require_uppercase = VALUES(require_uppercase),
         require_lowercase = VALUES(require_lowercase),
         require_digits = VALUES(require_digits),
         require_special_chars = VALUES(require_special_chars),
         max_repeated_chars = VALUES(max_repeated_chars),
         rotation_days = VALUES(rotation_days),
         history_count = VALUES(history_count),
         lockout_attempts = VALUES(lockout_attempts),
         lockout_duration_minutes = VALUES(lockout_duration_minutes),
         updated_at = NOW()`,
      [
        req.orgId,
        min_length !== undefined ? min_length : null,
        require_uppercase !== undefined ? (require_uppercase ? 1 : 0) : null,
        require_lowercase !== undefined ? (require_lowercase ? 1 : 0) : null,
        require_digits !== undefined ? (require_digits ? 1 : 0) : null,
        specialChars !== undefined ? (specialChars ? 1 : 0) : null,
        max_repeated_chars !== undefined ? max_repeated_chars : null,
        rotation_days !== undefined ? rotation_days : null,
        history_count !== undefined ? history_count : null,
        lockout_attempts !== undefined ? lockout_attempts : null,
        lockout_duration_minutes !== undefined ? lockout_duration_minutes : null,
      ],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// API Key Rate Limits
// ---------------------------------------------------------------------------

const UINT32_MAX = 0xFFFFFFFF;
const UINT16_MAX = 0xFFFF;
const UINT64_MAX = 18446744073709551615n;

function apiTokenIdParam(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new ValidationError('Invalid API token ID', [{ field: 'tokenId', message: 'tokenId must be a positive integer' }]);
  }
  try {
    if (BigInt(value) > UINT64_MAX) throw new Error('out of range');
  } catch (_err) {
    throw new ValidationError('Invalid API token ID', [{ field: 'tokenId', message: 'tokenId is outside the database ID range' }]);
  }
  return value;
}

function optionalRateLimit(body, field, max) {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new ValidationError('Invalid API token rate limit', [{
      field,
      message: `${field} must be a positive integer no greater than ${max}`,
    }]);
  }
  return value;
}

// GET /api-key-rate-limits — list
router.get('/api-key-rate-limits', requirePermission('api_key_rate_limits.view'), async (req, res, next) => {
  try {
    // API tokens and their policies are control-plane data, including when the
    // current organization routes subscriber data to an isolated database.
    const [rows] = await db.withPrimaryContext(() => db.query(
      'SELECT * FROM api_key_rate_limits WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    ));
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api-key-rate-limits/:tokenId — set rate limit for token
router.put('/api-key-rate-limits/:tokenId', requireInteractiveJwt, requirePermission('api_key_rate_limits.update'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const tokenId = apiTokenIdParam(req.params.tokenId);
    const requestsPerMinute = optionalRateLimit(body, 'requests_per_minute', UINT32_MAX);
    const requestsPerHour = optionalRateLimit(body, 'requests_per_hour', UINT32_MAX);
    const requestsPerDay = optionalRateLimit(body, 'requests_per_day', UINT32_MAX);
    const burstSize = optionalRateLimit(body, 'burst_size', UINT16_MAX);
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
      throw new ValidationError('Invalid API token rate limit', [{ field: 'is_active', message: 'is_active must be a boolean' }]);
    }
    const insertActive = body.is_active === undefined ? 1 : (body.is_active ? 1 : 0);
    const updateActive = body.is_active === undefined ? null : 1;

    await db.withPrimaryContext(async () => {
      // Never trust the path ID alone: api_token_id is globally unique and an
      // unchecked upsert let one tenant create or alter another tenant's row.
      const [tokens] = await db.query(
        `SELECT id FROM api_tokens
          WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
          LIMIT 2`,
        [tokenId, req.orgId],
      );
      if (!Array.isArray(tokens) || tokens.length !== 1) throw new NotFoundError('API token');

      await db.query(
        `INSERT INTO api_key_rate_limits
          (organization_id, api_token_id, requests_per_minute, requests_per_hour,
           requests_per_day, burst_size, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           organization_id = VALUES(organization_id),
           requests_per_minute = VALUES(requests_per_minute),
           requests_per_hour = VALUES(requests_per_hour),
           requests_per_day = VALUES(requests_per_day),
           burst_size = VALUES(burst_size),
           is_active = IF(? IS NULL, is_active, VALUES(is_active)),
           updated_at = NOW()`,
        [
          req.orgId,
          tokenId,
          requestsPerMinute,
          requestsPerHour,
          requestsPerDay,
          burstSize,
          insertActive,
          updateActive,
        ],
      );
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
