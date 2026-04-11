// =============================================================================
// FireISP 5.0 — Import Routes (Bulk CSV)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const importController = require('../controllers/importController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.post('/clients', requirePermission('clients.create'), importController.importClients);
router.post('/devices', requirePermission('devices.create'), importController.importDevices);
router.post('/contracts', requirePermission('contracts.create'), importController.importContracts);

module.exports = router;
