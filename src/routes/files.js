// =============================================================================
// FireISP 5.0 — File Routes
// =============================================================================

const { Router } = require('express');
const File = require('../models/File');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createFile, updateFile } = require('../middleware/schemas/files');

const router = Router();
const ctrl = crudController(File);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('files.view'), ctrl.list);
router.get('/:id', requirePermission('files.view'), ctrl.get);
router.post('/', requirePermission('files.create'), validate(createFile), ctrl.create);
router.put('/:id', requirePermission('files.update'), validate(updateFile), ctrl.update);
router.delete('/:id', requirePermission('files.delete'), ctrl.destroy);

module.exports = router;
