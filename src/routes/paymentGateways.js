// =============================================================================
// FireISP 5.0 — Payment Gateway Routes
// =============================================================================

const { Router } = require('express');
const PaymentGateway = require('../models/PaymentGateway');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createPaymentGateway, updatePaymentGateway } = require('../middleware/schemas/paymentGateways');

const router = Router();

// Never expose encrypted gateway credentials in any response body. secret_key_encrypted
// and webhook_secret_encrypted hold ciphertext at rest — but src/utils/encryption.js's
// encrypt()/decrypt() are transparent no-ops when ENCRYPTION_KEY is unset (dev/test/
// misconfigured prod), in which case these columns hold PLAINTEXT secrets. The UI only
// needs to know whether a secret is configured, not its value — expose booleans instead
// so it can render a "configured" badge. Mirrors src/routes/nas.js's redactNas.
function redactPaymentGateway(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  const hasSecretKey = Boolean(rest.secret_key_encrypted);
  const hasWebhookSecret = Boolean(rest.webhook_secret_encrypted);
  delete rest.secret_key_encrypted;
  delete rest.webhook_secret_encrypted;
  return { ...rest, has_secret_key: hasSecretKey, has_webhook_secret: hasWebhookSecret };
}

const ctrl = crudController(PaymentGateway, { serialize: redactPaymentGateway });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('payment_gateways.view'), ctrl.list);
router.get('/:id', requirePermission('payment_gateways.view'), ctrl.get);
router.post('/', requirePermission('payment_gateways.create'), validate(createPaymentGateway), ctrl.create);
router.put('/:id', requirePermission('payment_gateways.update'), validate(updatePaymentGateway), ctrl.update);
router.delete('/:id', requirePermission('payment_gateways.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('payment_gateways.update'), ctrl.restore);

module.exports = router;
