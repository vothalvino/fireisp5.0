// =============================================================================
// FireISP 5.0 — CFDI Workflow Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const cfdiController = require('../controllers/cfdiController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.post('/generate-xml',
  requirePermission('cfdi_documents.create'),
  validate({ cfdi_document_id: { type: 'number', required: true, min: 1 } }),
  cfdiController.generateXml,
);

router.post('/stamp',
  requirePermission('cfdi_documents.create'),
  validate({ cfdi_document_id: { type: 'number', required: true, min: 1 } }),
  cfdiController.stamp,
);

router.post('/cancel',
  requirePermission('cfdi_documents.update'),
  validate({
    cfdi_document_id: { type: 'number', required: true, min: 1 },
    reason: { type: 'string', required: true, enum: ['01', '02', '03', '04'] },
    replacement_uuid: { type: 'string' },
  }),
  cfdiController.cancel,
);

router.get('/:id/xml', requirePermission('cfdi_documents.view'), cfdiController.downloadXml);
router.get('/:id/pdf', requirePermission('cfdi_documents.view'), cfdiController.downloadPdf);

module.exports = router;
