// =============================================================================
// FireISP 5.0 — Settings Routes
// =============================================================================

const { Router } = require('express');
const Organization = require('../models/Organization');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { updateSetting } = require('../middleware/schemas/settings');
const { httpCache, bustCache } = require('../middleware/httpCache');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// List all settings for the current organization
router.get('/', requirePermission('settings.view'), httpCache('settings', 600), async (req, res, next) => {
  try {
    const settings = await Organization.getSettings(req.orgId);
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

// Update a single setting by key
router.put('/:key', requirePermission('settings.update'), validate(updateSetting), async (req, res, next) => {
  try {
    const { value } = req.body;
    await Organization.setSetting(req.orgId, req.params.key, value);
    await bustCache(req.orgId, 'settings');
    const settings = await Organization.getSettings(req.orgId);
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
