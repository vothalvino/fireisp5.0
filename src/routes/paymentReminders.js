// =============================================================================
// FireISP 5.0 — Payment Reminder Settings Routes
// =============================================================================
// GET /payment-reminder-settings — get settings
// PUT /payment-reminder-settings — upsert settings
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const paymentReminderService = require('../services/paymentReminderService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/',
  requirePermission('payment_reminders.view'),
  async (req, res, next) => {
    try {
      const settings = await paymentReminderService.getReminderSettings(req.organizationId);
      res.json(settings || {});
    } catch (err) {
      next(err);
    }
  },
);

router.put('/',
  requirePermission('payment_reminders.manage'),
  async (req, res, next) => {
    try {
      const settings = await paymentReminderService.upsertReminderSettings(
        req.organizationId,
        req.body,
      );
      res.json(settings);
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
