// =============================================================================
// FireISP 5.0 — Export Routes (CSV)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const exportController = require('../controllers/exportController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/invoices', requirePermission('invoices.export'), exportController.exportInvoices);
router.get('/clients', requirePermission('clients.export'), exportController.exportClients);
router.get('/contracts', requirePermission('contracts.export'), exportController.exportContracts);
router.get('/payments', requirePermission('payments.export'), exportController.exportPayments);

module.exports = router;
