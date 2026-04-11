// =============================================================================
// FireISP 5.0 — Dashboard Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const dashboardController = require('../controllers/dashboardController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/summary', requirePermission('audit_logs.view'), dashboardController.summary);
router.get('/revenue', requirePermission('invoices.view'), dashboardController.revenue);
router.get('/mrr', requirePermission('invoices.view'), dashboardController.mrr);
router.get('/device-health', requirePermission('devices.view'), dashboardController.deviceHealth);
router.get('/overdue', requirePermission('invoices.view'), dashboardController.overdue);

module.exports = router;
