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
const { uploadCsdCertificate, updateCsdCertificate } = require('../middleware/schemas/csdCertificates');
const crypto = require('crypto');
const db = require('../config/database');
const encryption = require('../utils/encryption');
const cfdiSealService = require('../services/cfdiSealService');
const auditLog = require('../services/auditLog');
const { AppError } = require('../utils/errors');

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

// Real upload: raw .cer/.key (base64) + passphrase. The server parses,
// validates the pair, matches the RFC against the org's fiscal profile, and
// encrypts the key material at rest. Replaces the old generic create that
// trusted client-sent certificate fields.
router.post('/', requirePermission('csd_certificates.create'), validate(uploadCsdCertificate), async (req, res, next) => {
  try {
    const { cer_b64, key_b64, passphrase } = req.body;

    // Production hard-stop: encrypt() is a silent no-op without
    // ENCRYPTION_KEY — the "encrypted" columns would hold the PLAINTEXT
    // private key of the certificate that signs legally-binding invoices.
    if (process.env.NODE_ENV === 'production' && !encryption.isConfigured()) {
      throw new AppError(
        'ENCRYPTION_KEY is not configured — refusing to store a CSD private key unencrypted. '
        + 'Set ENCRYPTION_KEY (64-char hex) in the server environment and retry.',
        422, 'ENCRYPTION_REQUIRED',
      );
    }

    let cerBuf; let keyBuf;
    try {
      cerBuf = Buffer.from(cer_b64, 'base64');
      keyBuf = Buffer.from(key_b64, 'base64');
    } catch (_) {
      throw new AppError('cer_b64/key_b64 must be base64-encoded files.', 422, 'CSD_INVALID');
    }

    // Parses + verifies the pair AND that the passphrase can open the key.
    const material = cfdiSealService.csdStorageMaterial(cerBuf, keyBuf, passphrase);
    const { info } = material;

    // The CSD must belong to this organization's registered RFC.
    const [profRows] = await db.query(
      'SELECT rfc FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );
    const orgRfc = profRows[0]?.rfc;
    if (!orgRfc) {
      throw new AppError(
        'The organization has no MX fiscal profile (RFC) — configure it before uploading a CSD.',
        422, 'ORG_MX_PROFILE_MISSING',
      );
    }
    if (info.rfc !== orgRfc) {
      throw new AppError(
        `This CSD belongs to RFC ${info.rfc}, but the organization's fiscal profile is ${orgRfc}.`,
        422, 'CSD_RFC_MISMATCH',
      );
    }
    if (info.valid_to.getTime() <= Date.now()) {
      throw new AppError(
        `This certificate expired on ${info.valid_to.toISOString().slice(0, 10)} — request its replacement from SAT (CertiSAT).`,
        422, 'CSD_EXPIRED',
      );
    }

    const fingerprint = crypto.createHash('sha256').update(material.cer_pem).digest('hex');
    const [dups] = await db.query(
      'SELECT id FROM csd_certificates WHERE organization_id = ? AND fingerprint_sha256 = ? AND deleted_at IS NULL',
      [req.orgId, fingerprint],
    );
    if (dups[0]) {
      throw new AppError(`This certificate is already uploaded (#${dups[0].id}).`, 409, 'CSD_DUPLICATE');
    }

    // First certificate for the org becomes active immediately; successors
    // stay inactive until explicitly activated (zero-downtime renewal).
    const [actives] = await db.query(
      "SELECT id FROM csd_certificates WHERE organization_id = ? AND is_active = 1 AND status = 'active' AND deleted_at IS NULL",
      [req.orgId],
    );
    const isActive = actives.length === 0 ? 1 : 0;

    const [result] = await db.query(
      `INSERT INTO csd_certificates
         (organization_id, rfc, certificate_number, issuer_name, valid_from, valid_to,
          cer_pem, key_pem_encrypted, passphrase_encrypted, fingerprint_sha256, is_active, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        req.orgId, info.rfc, info.certificate_number, info.issuer,
        info.valid_from, info.valid_to,
        material.cer_pem, encryption.encrypt(material.key_pem), encryption.encrypt(passphrase),
        fingerprint, isActive,
      ],
    );

    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'csd_uploaded',
      tableName: 'csd_certificates', recordId: result.insertId,
      summary: `CSD ${info.certificate_number} (RFC ${info.rfc}, valid to ${info.valid_to.toISOString().slice(0, 10)}${info.is_test_certificate ? ', TEST certificate' : ''})`,
    });

    res.status(201).json({
      data: {
        id: result.insertId, rfc: info.rfc, certificate_number: info.certificate_number,
        legal_name: info.legal_name, issuer: info.issuer,
        valid_from: info.valid_from, valid_to: info.valid_to,
        is_active: isActive, status: 'active',
        is_test_certificate: info.is_test_certificate,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Zero-downtime renewal: activate one certificate, deactivating its siblings
// in the same statement pair. Expired/revoked certs cannot be activated.
router.post('/:id/activate', requirePermission('csd_certificates.update'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, status, valid_to FROM csd_certificates WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    const cert = rows[0];
    if (!cert) throw new AppError('CSD certificate not found.', 404, 'NOT_FOUND');
    if (cert.status !== 'active' || new Date(cert.valid_to).getTime() <= Date.now()) {
      throw new AppError(
        `Only a valid, non-expired certificate can be activated (this one is '${cert.status}', valid to ${new Date(cert.valid_to).toISOString().slice(0, 10)}).`,
        422, 'CSD_NOT_ACTIVATABLE',
      );
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE csd_certificates SET is_active = 0 WHERE organization_id = ?', [req.orgId]);
      await conn.execute('UPDATE csd_certificates SET is_active = 1 WHERE id = ?', [cert.id]);
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }

    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'csd_activated',
      tableName: 'csd_certificates', recordId: cert.id,
      summary: `CSD #${cert.id} is now the active signing certificate`,
    });
    res.json({ data: { id: cert.id, is_active: 1 } });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('csd_certificates.update'), validate(updateCsdCertificate), ctrl.update);
router.delete('/:id', requirePermission('csd_certificates.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('csd_certificates.update'), ctrl.restore);

module.exports = router;
