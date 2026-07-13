// =============================================================================
// FireISP 5.0 — CSD Certificate Routes
// =============================================================================

const { Router } = require('express');
const CsdCertificate = require('../models/CsdCertificate');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requireMxLocale } = require('../middleware/orgLocale');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createCsdCertificate, updateCsdCertificate } = require('../middleware/schemas/csdCertificates');

const router = Router();

// Never expose the encrypted CSD private key (used to digitally sign CFDI
// documents) or its passphrase in any response body. Both columns hold
// ciphertext at rest — but src/utils/encryption.js's encrypt()/decrypt() are
// transparent no-ops when ENCRYPTION_KEY is unset (dev/test/misconfigured
// prod), in which case they hold the PLAINTEXT PEM private key. The UI only
// needs to know whether a certificate has a key configured, not its value.
// cer_pem (the public certificate) is NOT secret and is left untouched.
// Mirrors src/routes/paymentGateways.js's redact.
function redactCsdCertificate(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  const hasKeyPem = Boolean(rest.key_pem_encrypted);
  const hasPassphrase = Boolean(rest.passphrase_encrypted);
  delete rest.key_pem_encrypted;
  delete rest.passphrase_encrypted;
  return { ...rest, has_key_pem: hasKeyPem, has_passphrase: hasPassphrase };
}

const ctrl = crudController(CsdCertificate, { serialize: redactCsdCertificate });

router.use(authenticate);
router.use(orgScope);
router.use(requireMxLocale);

router.get('/', requirePermission('csd_certificates.view'), ctrl.list);
router.get('/:id', requirePermission('csd_certificates.view'), ctrl.get);
router.post('/', requirePermission('csd_certificates.create'), validate(createCsdCertificate), ctrl.create);
router.put('/:id', requirePermission('csd_certificates.update'), validate(updateCsdCertificate), ctrl.update);
router.delete('/:id', requirePermission('csd_certificates.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('csd_certificates.update'), ctrl.restore);

module.exports = router;
