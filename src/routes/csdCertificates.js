// =============================================================================
// FireISP 5.0 — CSD Certificate Routes
// =============================================================================

const { Router } = require('express');
const CsdCertificate = require('../models/CsdCertificate');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');

const router = Router();
const ctrl = crudController(CsdCertificate);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('csd_certificates.view'), ctrl.list);
router.get('/:id', requirePermission('csd_certificates.view'), ctrl.get);
router.post('/', requirePermission('csd_certificates.create'), ctrl.create);
router.put('/:id', requirePermission('csd_certificates.update'), ctrl.update);
router.delete('/:id', requirePermission('csd_certificates.delete'), ctrl.destroy);

module.exports = router;
