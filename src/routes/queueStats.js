// =============================================================================
// FireISP 5.0 — Queue Stats Route
// =============================================================================
// GET /api/v1/queue-stats  — returns waiting/active/completed/failed/delayed
// counts for each named BullMQ queue (or "in-process" mode indicator).
// Requires: JWT authentication + settings.view permission.
// =============================================================================

const express = require('express');

const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const jobQueue = require('../services/jobQueueService');

/**
 * GET /api/v1/queue-stats
 * Returns job queue statistics for all named queues.
 */
router.get('/', authenticate, requirePermission('settings.view'), async (_req, res, next) => {
  try {
    const stats = await jobQueue.getStats();
    return res.json(stats);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
