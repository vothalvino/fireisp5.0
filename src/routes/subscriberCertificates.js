// =============================================================================
// FireISP 5.0 — Subscriber Certificate Routes
// =============================================================================
// Metadata registry for subscriber EAP-TLS certificates (§3.1 item 6).
// NOTE: FireISP is a metadata registry only — it does NOT generate or sign
// certificates. Certificate files are managed by an external CA (e.g.
// easy-rsa, step-ca, or a commercial CA). Only metadata (serial, fingerprint,
// validity dates) is stored here.
// =============================================================================

const { Router } = require('express');
const SubscriberCertificate = require('../models/SubscriberCertificate');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createSubscriberCertificate,
  updateSubscriberCertificate,
  revokeSubscriberCertificate,
} = require('../middleware/schemas/subscriberCertificates');

const router = Router();
const ctrl = crudController(SubscriberCertificate);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('subscriber_certificates.view'), ctrl.list);
router.get('/:id', requirePermission('subscriber_certificates.view'), ctrl.get);
router.post('/', requirePermission('subscriber_certificates.create'), validate(createSubscriberCertificate), ctrl.create);
router.put('/:id', requirePermission('subscriber_certificates.update'), validate(updateSubscriberCertificate), ctrl.update);
router.delete('/:id', requirePermission('subscriber_certificates.revoke'), ctrl.destroy);

// List certificates for a specific RADIUS account
router.get('/radius-account/:radiusAccountId', requirePermission('subscriber_certificates.view'), async (req, res, next) => {
  try {
    const certs = await SubscriberCertificate.findByRadiusAccount(req.params.radiusAccountId);
    res.json({ data: certs });
  } catch (err) {
    next(err);
  }
});

// List certificates for a specific client
router.get('/client/:clientId', requirePermission('subscriber_certificates.view'), async (req, res, next) => {
  try {
    const certs = await SubscriberCertificate.findByClient(req.params.clientId);
    res.json({ data: certs });
  } catch (err) {
    next(err);
  }
});

// Revoke a certificate
router.post('/:id/revoke', requirePermission('subscriber_certificates.revoke'), validate(revokeSubscriberCertificate), async (req, res, next) => {
  try {
    const cert = await SubscriberCertificate.findByIdOrFail(req.params.id);
    if (cert.status === 'revoked') {
      return res.status(409).json({ error: 'Certificate is already revoked' });
    }
    await SubscriberCertificate.revoke(cert.id, req.body.revocation_reason);
    const updated = await SubscriberCertificate.findById(cert.id);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
