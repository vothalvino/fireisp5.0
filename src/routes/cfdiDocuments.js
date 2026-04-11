// =============================================================================
// FireISP 5.0 — CFDI Document Routes
// =============================================================================

const { Router } = require('express');
const CfdiDocument = require('../models/CfdiDocument');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createCfdiDocument, updateCfdiDocument, cancelCfdiDocument } = require('../middleware/schemas/cfdiDocuments');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(CfdiDocument);

router.use(authenticate);
router.use(orgScope);

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
    const [result] = await db.query(
      `INSERT INTO cfdi_cancellations (cfdi_document_id, motivo, folio_sustitucion, cancelled_by)
       VALUES (?, ?, ?, ?)`,
      [req.params.id, motivo, folio_sustitucion || null, req.user.id],
    );
    await db.query(
      'UPDATE cfdi_documents SET status = ?, cancelled_at = NOW() WHERE id = ?',
      ['cancelled', req.params.id],
    );
    const [rows] = await db.query('SELECT * FROM cfdi_cancellations WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
