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
const cfdiService = require('../services/cfdiService');
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
//
// This does NOT hand-roll the cancellation SQL — it delegates to
// cfdiService.cancel(), the canonical PAC → SAT cancellation flow also used by
// POST /cfdi/cancel (src/controllers/cfdiController.js). An earlier version of
// this route inserted cfdi_cancellations directly and immediately set
// sat_status='cancelado' + cancelled_at=NOW() with NO PAC/SAT submission at
// all. Per the column comments in database/schema.sql, 'cancelado' means "SAT
// confirmed cancellation" and cancelled_at means "Timestamp when SAT confirmed
// cancellation" — that write was a legally false fiscal record: SAT still held
// the CFDI as vigente while FireISP reported it cancelled (which would
// under-report declared income in getReconciliationReport /
// getMonthlyReport), and — because cfdiService.cancel() guards
// `sat_status !== 'vigente'` — the document became permanently
// un-cancellable through the real flow afterwards. cfdiService.cancel()
// correctly records the request as cancellation_status='pending' and sets
// sat_status='cancel_pending'; it only becomes 'cancelado' (and cancelled_at
// gets set) once the PAC/SAT response is processed (immediately if the PAC
// answers synchronously, or later via GET /cfdi/:id/cancellation-status).
router.post('/:id/cancel', requirePermission('cfdi_documents.update'), validate(cancelCfdiDocument), async (req, res, next) => {
  try {
    const { cancellation_reason, replacement_uuid } = req.body;

    // Org-scope before delegating: cfdiService.cancel() looks the document up
    // by id alone and does not itself check organization_id.
    const [docs] = await db.query(
      'SELECT id FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!docs[0]) {
      throw new NotFoundError('CFDI document');
    }

    const result = await cfdiService.cancel(req.params.id, cancellation_reason, replacement_uuid || null);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
