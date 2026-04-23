// =============================================================================
// FireISP 5.0 — Dashboard Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { httpCache } = require('../middleware/httpCache');
const dashboardController = require('../controllers/dashboardController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/summary', requirePermission('audit_logs.view'), httpCache('dashboard_summary', 60), dashboardController.summary);
router.get('/revenue', requirePermission('invoices.view'), httpCache('dashboard_revenue', 300), dashboardController.revenue);
router.get('/mrr', requirePermission('invoices.view'), httpCache('dashboard_mrr', 300), dashboardController.mrr);
router.get('/device-health', requirePermission('devices.view'), httpCache('dashboard_device_health', 120), dashboardController.deviceHealth);
router.get('/overdue', requirePermission('invoices.view'), httpCache('dashboard_overdue', 60), dashboardController.overdue);

module.exports = router;
