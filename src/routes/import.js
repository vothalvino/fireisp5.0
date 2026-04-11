// =============================================================================
// FireISP 5.0 — Import Routes (Bulk CSV)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const importSchemas = require('../middleware/schemas/import');
const importController = require('../controllers/importController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.post('/clients', requirePermission('clients.create'), validate(importSchemas.importCsv), importController.importClients);
router.post('/devices', requirePermission('devices.create'), validate(importSchemas.importCsv), importController.importDevices);
router.post('/contracts', requirePermission('contracts.create'), validate(importSchemas.importCsv), importController.importContracts);

module.exports = router;
