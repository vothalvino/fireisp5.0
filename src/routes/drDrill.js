// =============================================================================
// FireISP 5.0 — DR Drill Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const drDrillService = require('../services/drDrillService');

const router = Router();

router.use(authenticate);

// GET /dr-drill/status
// Returns the latest drill log entry plus an overdue flag.
// Accessible to all authenticated admins.
router.get('/status', requirePermission('settings.view'), async (req, res, next) => {
  try {
    const status = await drDrillService.getDrillStatus();
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
