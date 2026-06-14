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
const { ValidationError, NotFoundError } = require('../utils/errors');

const router = Router();

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

// GET /admin-ip-allowlist — list org admin IP allowlist
router.get('/admin-ip-allowlist', requirePermission('admin_ip_allowlist.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM admin_ip_allowlist WHERE organization_id = ? ORDER BY id DESC',
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
    const cidrValue = cidr ?? ip_address;
    if (!cidrValue) {
      throw new ValidationError('Validation failed', [{ field: 'cidr', message: 'cidr (or ip_address) is required' }]);
    }
    const [result] = await db.query(
      `INSERT INTO admin_ip_allowlist (organization_id, cidr, description, is_active, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [req.orgId, cidrValue, description || null, is_active !== false ? 1 : 0, req.user.id],
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
    const cidrValue = cidr ?? ip_address ?? null;
    const [result] = await db.query(
      `UPDATE admin_ip_allowlist
       SET cidr = COALESCE(?, cidr),
           description = ?,
           is_active = COALESCE(?, is_active),
           updated_at = NOW()
       WHERE id = ? AND organization_id = ?`,
      [cidrValue, description !== undefined ? description : null, is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.id, req.orgId],
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
    const [result] = await db.query(
      'DELETE FROM admin_ip_allowlist WHERE id = ? AND organization_id = ?',
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

// GET /api-key-rate-limits — list
router.get('/api-key-rate-limits', requirePermission('api_key_rate_limits.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM api_key_rate_limits WHERE organization_id = ? ORDER BY id DESC',
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api-key-rate-limits/:tokenId — set rate limit for token
router.put('/api-key-rate-limits/:tokenId', requirePermission('api_key_rate_limits.update'), async (req, res, next) => {
  try {
    const { requests_per_minute, requests_per_hour, requests_per_day, burst_size } = req.body;
    const tokenId = req.params.tokenId;

    await db.query(
      `INSERT INTO api_key_rate_limits
        (organization_id, api_token_id, requests_per_minute, requests_per_hour, requests_per_day, burst_size)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         requests_per_minute = VALUES(requests_per_minute),
         requests_per_hour = VALUES(requests_per_hour),
         requests_per_day = VALUES(requests_per_day),
         burst_size = VALUES(burst_size),
         updated_at = NOW()`,
      [
        req.orgId,
        tokenId,
        requests_per_minute || null,
        requests_per_hour || null,
        requests_per_day || null,
        burst_size || null,
      ],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
