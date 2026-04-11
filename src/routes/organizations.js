// =============================================================================
// FireISP 5.0 — Organization Routes
// =============================================================================

const { Router } = require('express');
const Organization = require('../models/Organization');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createOrganization, updateOrganization, updateSetting } = require('../middleware/schemas/organizations');

const router = Router();
const ctrl = crudController(Organization);

router.use(authenticate);

router.get('/', requirePermission('organizations.view'), ctrl.list);
router.get('/:id', requirePermission('organizations.view'), ctrl.get);
router.post('/', requirePermission('organizations.create'), validate(createOrganization), ctrl.create);
router.put('/:id', requirePermission('organizations.update'), validate(updateOrganization), ctrl.update);
router.delete('/:id', requirePermission('organizations.delete'), ctrl.destroy);

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

module.exports = router;
