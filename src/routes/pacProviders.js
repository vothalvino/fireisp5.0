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

router.get('/', requirePermission('pac_providers.view'), ctrl.list);
router.get('/:id', requirePermission('pac_providers.view'), ctrl.get);
router.post('/', requirePermission('pac_providers.create'), validate(createPacProvider), ctrl.create);
router.put('/:id', requirePermission('pac_providers.update'), validate(updatePacProvider), ctrl.update);
router.delete('/:id', requirePermission('pac_providers.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('pac_providers.update'), ctrl.restore);

module.exports = router;
