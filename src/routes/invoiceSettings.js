// =============================================================================
// FireISP 5.0 — Invoice Settings Routes
// =============================================================================
// GET  /invoice-settings       — get branding settings for current org
// PUT  /invoice-settings       — upsert branding settings
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const invoiceSettingsService = require('../services/invoiceSettingsService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/',
  requirePermission('invoice_settings.view'),
  async (req, res, next) => {
    try {
      const settings = await invoiceSettingsService.getInvoiceSettings(req.organizationId);
      res.json(settings || {});
    } catch (err) {
      next(err);
    }
  },
);

router.put('/',
  requirePermission('invoice_settings.update'),
  async (req, res, next) => {
    try {
      const settings = await invoiceSettingsService.upsertInvoiceSettings(
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
