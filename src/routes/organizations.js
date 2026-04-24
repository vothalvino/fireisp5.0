// =============================================================================
// FireISP 5.0 — Organization Routes
// =============================================================================

const { Router } = require('express');
const Organization = require('../models/Organization');
const OrganizationQuota = require('../models/OrganizationQuota');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createOrganization, updateOrganization, patchOrganization, updateSetting } = require('../middleware/schemas/organizations');
const { getQuotaWithUsage } = require('../services/quotaService');

const router = Router();
const ctrl = crudController(Organization);

router.use(authenticate);

router.get('/', requirePermission('organizations.view'), ctrl.list);
router.get('/:id', requirePermission('organizations.view'), ctrl.get);
router.post('/', requirePermission('organizations.create'), validate(createOrganization), ctrl.create);
router.put('/:id', requirePermission('organizations.update'), validate(updateOrganization), ctrl.update);
router.patch('/:id', requirePermission('organizations.update'), validate(patchOrganization), ctrl.partialUpdate);
router.delete('/:id', requirePermission('organizations.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('organizations.update'), ctrl.restore);

// Settings sub-routes
router.get('/:id/settings', requirePermission('settings.view'), async (req, res, next) => {
  try {
    const settings = await Organization.getSettings(req.params.id);
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/settings', requirePermission('settings.update'), validate(updateSetting), async (req, res, next) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await Organization.setSetting(req.params.id, key, value);
    }
    const settings = await Organization.getSettings(req.params.id);
    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

// Quota sub-routes
router.get('/:id/quota', requirePermission('organizations.view'), async (req, res, next) => {
  try {
    const data = await getQuotaWithUsage(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/quota', requirePermission('organizations.update'), async (req, res, next) => {
  try {
    const QUOTA_FIELDS = ['max_clients', 'max_devices', 'max_storage_mb', 'max_scheduled_tasks'];
    const { ValidationError: VE } = require('../utils/errors');
    const body = req.body || {};
    for (const key of Object.keys(body)) {
      if (!QUOTA_FIELDS.includes(key)) {
        return next(new VE(`Unknown quota field: ${key}`));
      }
      const val = body[key];
      if (val !== null && val !== '') {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 0) {
          return next(new VE(`${key} must be a non-negative integer or null`));
        }
      }
    }
    await OrganizationQuota.upsert(req.params.id, body);
    const data = await getQuotaWithUsage(req.params.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
