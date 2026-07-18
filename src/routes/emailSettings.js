// =============================================================================
// FireISP 5.0 — Per-Organization Email (SMTP) Settings Routes
// =============================================================================
// GET  /email-settings       — get outbound email config for the current org
//                               (password NEVER included — see toPublic())
// PUT  /email-settings       — upsert config (write-only password field,
//                               three-state contract: omit=keep / ""=clear /
//                               value=re-encrypt+replace)
// POST /email-settings/test  — send a real test email using the org's (or
//                               global fallback) SMTP transport
//
// Mounted at /api/v1/email-settings. email_settings.view/email_settings.update
// are granted to admin + super_admin ONLY (migration 386) — an SMTP
// credential is org-wide send-as-anyone infrastructure, not a business-role-
// scoped resource.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { updateEmailSettings, testEmailSettings } = require('../middleware/schemas/emailSettings');
const emailSettingsService = require('../services/emailSettingsService');
const logger = require('../utils/logger').child({ service: 'routes/emailSettings' });

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/',
  requirePermission('email_settings.view'),
  async (req, res, next) => {
    try {
      // Legacy single-identity route: operates on the 'general' function.
      const settings = await emailSettingsService.getEmailSettings(req.orgId, 'general');
      res.json({ data: settings });
    } catch (err) {
      next(err);
    }
  },
);

router.put('/',
  requirePermission('email_settings.update'),
  validate(updateEmailSettings),
  async (req, res, next) => {
    try {
      const settings = await emailSettingsService.saveEmailSettings(req.orgId, 'general', req.body);
      logger.info({ orgId: req.orgId, userId: req.user?.id }, 'Email settings updated');
      res.json({ data: settings });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/test',
  requirePermission('email_settings.update'),
  validate(testEmailSettings),
  async (req, res, next) => {
    try {
      const result = await emailSettingsService.testEmailSettings(req.orgId, 'general', req.body.to);
      logger.info({ orgId: req.orgId, userId: req.user?.id, success: result.success }, 'Email settings test sent');
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
