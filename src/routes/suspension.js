// =============================================================================
// FireISP 5.0 — Suspension Workflow Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const suspensionSchemas = require('../middleware/schemas/suspension');
const suspensionController = require('../controllers/suspensionController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.post('/evaluate',
  requirePermission('contracts.view'),
  suspensionController.evaluate,
);

router.post('/suspend',
  requirePermission('contracts.update'),
  validate(suspensionSchemas.suspend),
  suspensionController.suspend,
);

router.post('/reconnect',
  requirePermission('contracts.update'),
  validate(suspensionSchemas.reconnect),
  suspensionController.reconnect,
);

router.post('/run-auto',
  requirePermission('contracts.update'),
  suspensionController.runAuto,
);

module.exports = router;
