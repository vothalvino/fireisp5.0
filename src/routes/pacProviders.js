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

router.get('/', requirePermission('pac_providers.view'), ctrl.list);
router.get('/:id', requirePermission('pac_providers.view'), ctrl.get);
router.post('/', requirePermission('pac_providers.create'), validate(createPacProvider), guardApiUrl, ctrl.create);
router.put('/:id', requirePermission('pac_providers.update'), validate(updatePacProvider), guardApiUrl, ctrl.update);
router.delete('/:id', requirePermission('pac_providers.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('pac_providers.update'), ctrl.restore);

module.exports = router;
