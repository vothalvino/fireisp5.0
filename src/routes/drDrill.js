// =============================================================================
// FireISP 5.0 — DR Drill Routes
// =============================================================================

const { Router } = require('express');
const fs = require('fs/promises');
const path = require('path');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const drDrillService = require('../services/drDrillService');

const router = Router();

// The runbook ships with the install (repo docs/ is copied into the image);
// serving it from disk keeps the in-app copy version-matched to the code.
const RUNBOOK_PATH = path.join(__dirname, '..', '..', 'docs', 'dr-drill.md');

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

// GET /dr-drill/runbook
// The DR runbook document (docs/dr-drill.md) as markdown, rendered on the
// /dr-drill admin page. Same permission as the status view.
router.get('/runbook', requirePermission('settings.view'), async (req, res, next) => {
  try {
    const markdown = await fs.readFile(RUNBOOK_PATH, 'utf8');
    res.json({ data: { markdown } });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: { message: 'Runbook document not found on this install' } });
    }
    next(err);
  }
});

module.exports = router;
