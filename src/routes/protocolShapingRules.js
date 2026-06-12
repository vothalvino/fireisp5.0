// =============================================================================
// FireISP 5.0 — Protocol Shaping Rule Routes (§10.2)
// =============================================================================

const { Router } = require('express');
const ProtocolShapingRule = require('../models/ProtocolShapingRule');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createProtocolShapingRule, updateProtocolShapingRule } = require('../middleware/schemas/protocolShapingRules');
const { exportShapingRulesConfig } = require('../services/qosService');

const router = Router();
const ctrl = crudController(ProtocolShapingRule);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('protocol_shaping_rules.view'), ctrl.list);
router.get('/:id', requirePermission('protocol_shaping_rules.view'), ctrl.get);
router.post('/', requirePermission('protocol_shaping_rules.create'), validate(createProtocolShapingRule), ctrl.create);
router.put('/:id', requirePermission('protocol_shaping_rules.update'), validate(updateProtocolShapingRule), ctrl.update);
router.delete('/:id', requirePermission('protocol_shaping_rules.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('protocol_shaping_rules.update'), ctrl.restore);

// Export MikroTik mangle rules script
router.get('/export/config', requirePermission('protocol_shaping_rules.view'), async (req, res, next) => {
  try {
    const planId = req.query.plan_id ? Number(req.query.plan_id) : null;
    const result = await exportShapingRulesConfig(req.orgId, planId);
    if (req.query.format === 'text') {
      res.set('Content-Type', 'text/plain');
      res.set('Content-Disposition', 'attachment; filename="shaping-rules.rsc"');
      return res.send(result.script);
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
