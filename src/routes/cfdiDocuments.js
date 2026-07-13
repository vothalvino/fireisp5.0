// =============================================================================
// FireISP 5.0 — CFDI Document Routes
// =============================================================================

const { Router } = require('express');
const CfdiDocument = require('../models/CfdiDocument');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requireMxLocale } = require('../middleware/orgLocale');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createCfdiDocument, updateCfdiDocument, cancelCfdiDocument } = require('../middleware/schemas/cfdiDocuments');
const { NotFoundError } = require('../utils/errors');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(CfdiDocument);

router.use(authenticate);
router.use(orgScope);
router.use(requireMxLocale);

router.get('/', requirePermission('cfdi_documents.view'), ctrl.list);
router.get('/:id', requirePermission('cfdi_documents.view'), ctrl.get);
router.post('/', requirePermission('cfdi_documents.create'), validate(createCfdiDocument), ctrl.create);
router.put('/:id', requirePermission('cfdi_documents.update'), validate(updateCfdiDocument), ctrl.update);

// Get CFDI conceptos
router.get('/:id/conceptos', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const conceptos = await CfdiDocument.getConceptos(req.params.id);
    res.json({ data: conceptos });
  } catch (err) {
    next(err);
  }
});

// Get related CFDI documents
router.get('/:id/related', requirePermission('cfdi_documents.view'), async (req, res, next) => {
  try {
    const related = await CfdiDocument.getRelatedDocuments(req.params.id);
    res.json({ data: related });
  } catch (err) {
    next(err);
  }
});

// Cancel a CFDI document
router.post('/:id/cancel', requirePermission('cfdi_documents.update'), validate(cancelCfdiDocument), async (req, res, next) => {
  try {
    const { motivo, folio_sustitucion } = req.body;
    // cfdi_cancellations requires organization_id + uuid + requested_at (all NOT
    // NULL) and the user column is requested_by_user_id, not cancelled_by. The
    // org and the folio fiscal are taken from the CFDI document itself, which
    // also scopes the cancellation to the caller's organization.
    const [result] = await db.query(
      `INSERT INTO cfdi_cancellations
         (cfdi_document_id, organization_id, uuid, motivo, folio_sustitucion,
          requested_by_user_id, requested_at)
       SELECT d.id, d.organization_id, d.uuid, ?, ?, ?, NOW()
       FROM cfdi_documents d
       WHERE d.id = ? AND d.organization_id = ? AND d.uuid IS NOT NULL`,
      [motivo, folio_sustitucion || null, req.user.id, req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundError('CFDI document (or it has not been stamped yet)');
    }
    // Column is sat_status ENUM('draft','vigente','cancelado','cancel_pending') —
    // there is no `status` column and no 'cancelled' value (database/schema.sql).
    await db.query(
      'UPDATE cfdi_documents SET sat_status = ?, cancelled_at = NOW() WHERE id = ? AND organization_id = ?',
      ['cancelado', req.params.id, req.orgId],
    );
    const [rows] = await db.query('SELECT * FROM cfdi_cancellations WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
