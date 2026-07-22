// =============================================================================
// FireISP 5.0 — PAC Provider Routes
// =============================================================================

const { Router } = require('express');
const PacProvider = require('../models/PacProvider');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requireMxLocale } = require('../middleware/orgLocale');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPacProvider, updatePacProvider } = require('../middleware/schemas/pacProviders');
const { assertSafeOutboundUrl } = require('../utils/safeOutboundUrl');
const db = require('../config/database');
const auditLog = require('../services/auditLog');
const { AppError } = require('../utils/errors');

const router = Router();

// Never expose encrypted PAC (Proveedor Autorizado de Certificación) account
// credentials in any response body. All four columns hold ciphertext at
// rest — but src/utils/encryption.js's encrypt()/decrypt() are transparent
// no-ops when ENCRYPTION_KEY is unset (dev/test/misconfigured prod), in which
// case they hold PLAINTEXT credentials. The UI only needs to know whether a
// credential is configured, not its value. Mirrors
// src/routes/paymentGateways.js's redact.
function redactPacProvider(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  const hasUsername = Boolean(rest.username_encrypted);
  const hasPassword = Boolean(rest.password_encrypted);
  const hasApiKey = Boolean(rest.api_key_encrypted);
  const hasToken = Boolean(rest.token_encrypted);
  delete rest.username_encrypted;
  delete rest.password_encrypted;
  delete rest.api_key_encrypted;
  delete rest.token_encrypted;
  return {
    ...rest,
    has_username: hasUsername,
    has_password: hasPassword,
    has_api_key: hasApiKey,
    has_token: hasToken,
  };
}

const ctrl = crudController(PacProvider, { serialize: redactPacProvider });

router.use(authenticate);
router.use(orgScope);
router.use(requireMxLocale);

// api_url is a server-side outbound target — reject SSRF destinations
// (non-https, private/loopback/metadata) before it can be stored and used
// as a PAC endpoint. Only runs when api_url is present in the body.
async function guardApiUrl(req, _res, next) {
  try {
    if (req.body && req.body.api_url !== undefined && req.body.api_url !== null && req.body.api_url !== '') {
      req.body.api_url = await assertSafeOutboundUrl(req.body.api_url, 'api_url');
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// -----------------------------------------------------------------------------
// Active fiscal environment (sandbox | production) for the caller's org.
// This single switch decides which PAC rows stamp/cancel: sandbox and
// production PACs are separate rows with different credentials/endpoints, so
// cfdiService only uses the rows whose `environment` matches this value. It
// lives on organization_mx_profiles.pac_environment and is read by
// cfdiService.orgPacEnvironment(). Declared BEFORE '/:id' so 'environment' is
// not captured as an :id.
router.get('/environment', requirePermission('pac_providers.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT pac_environment FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );
    // No fiscal profile yet → the effective environment is the column default.
    res.json({ data: { pac_environment: rows[0]?.pac_environment || 'sandbox' } });
  } catch (err) {
    next(err);
  }
});

router.put('/environment', requirePermission('pac_providers.update'), async (req, res, next) => {
  try {
    const value = req.body?.pac_environment;
    if (value !== 'sandbox' && value !== 'production') {
      throw new AppError("pac_environment must be 'sandbox' or 'production'.", 422, 'VALIDATION_ERROR');
    }
    // The switch lives on the fiscal profile, which requires the emisor identity
    // (RFC, razón social, …) to exist first. Refuse clearly rather than silently
    // creating a half-built profile — you cannot stamp without one anyway.
    const [existing] = await db.query(
      'SELECT id FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );
    if (!existing[0]) {
      throw new AppError(
        'Configure the organization fiscal profile (Organization → Fiscal) before choosing a PAC environment.',
        422, 'ORG_MX_PROFILE_MISSING',
      );
    }
    // Going live must not leave the org unable to stamp: refuse 'production'
    // unless at least one active production PAC exists (otherwise every stamp
    // would fail "no active PAC in production mode"). Sandbox has no such gate.
    if (value === 'production') {
      const [prodPacs] = await db.query(
        "SELECT id FROM pac_providers WHERE organization_id = ? AND status = 'active' AND environment = 'production' AND deleted_at IS NULL LIMIT 1",
        [req.orgId],
      );
      if (!prodPacs[0]) {
        throw new AppError(
          'Add and activate at least one PAC with Environment = production before switching to production.',
          422, 'NO_PRODUCTION_PAC',
        );
      }
    }
    await db.query(
      'UPDATE organization_mx_profiles SET pac_environment = ? WHERE organization_id = ? AND deleted_at IS NULL',
      [value, req.orgId],
    );
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'update',
      tableName: 'organization_mx_profiles', recordId: existing[0].id,
      summary: `Set PAC fiscal environment to ${value}`,
    });
    res.json({ data: { pac_environment: value } });
  } catch (err) {
    next(err);
  }
});

router.get('/', requirePermission('pac_providers.view'), ctrl.list);
router.get('/:id', requirePermission('pac_providers.view'), ctrl.get);
router.post('/', requirePermission('pac_providers.create'), validate(createPacProvider), guardApiUrl, ctrl.create);
router.put('/:id', requirePermission('pac_providers.update'), validate(updatePacProvider), guardApiUrl, ctrl.update);
router.delete('/:id', requirePermission('pac_providers.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('pac_providers.update'), ctrl.restore);

module.exports = router;
