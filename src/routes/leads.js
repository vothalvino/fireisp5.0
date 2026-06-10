// =============================================================================
// FireISP 5.0 — Lead Routes (prospect pipeline) — §1.2
// =============================================================================

const { Router } = require('express');
const Lead = require('../models/Lead');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createLead, updateLead, patchLead, convertLead } = require('../middleware/schemas/leads');
const lifecycleService = require('../services/lifecycleService');
const auditLog = require('../services/auditLog');

const router = Router();
const ctrl = crudController(Lead, { cacheResource: 'leads' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('leads.view'), ctrl.list);

// Pipeline stage counts — must precede '/:id'
router.get('/pipeline', requirePermission('leads.view'), async (req, res, next) => {
  try {
    const counts = await Lead.pipelineCounts(req.orgId);
    res.json({ data: counts });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('leads.view'), ctrl.get);
router.post('/', requirePermission('leads.create'), validate(createLead), ctrl.create);
router.put('/:id', requirePermission('leads.update'), validate(updateLead), ctrl.update);
router.patch('/:id', requirePermission('leads.update'), validate(patchLead), ctrl.partialUpdate);
router.delete('/:id', requirePermission('leads.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('leads.update'), ctrl.restore);

// Convert a lead into a client (creates the client, marks the lead won)
router.post('/:id/convert', requirePermission('clients.create'), validate(convertLead), async (req, res, next) => {
  try {
    const result = await lifecycleService.convertLead(req.params.id, req.orgId, req.body || {});
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'convert',
      tableName: 'leads',
      recordId: parseInt(req.params.id, 10),
      newValues: { converted_client_id: result.client.id },
    }).catch(() => {});
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

module.exports = router;
