// =============================================================================
// FireISP 5.0 — Queue Tree Node Routes (§10.1)
// =============================================================================

const { Router } = require('express');
const QueueTreeNode = require('../models/QueueTreeNode');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createQueueTreeNode, updateQueueTreeNode } = require('../middleware/schemas/queueTreeNodes');
const { exportQueueTreeConfig } = require('../services/qosService');

const router = Router();
const ctrl = crudController(QueueTreeNode);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('queue_tree_nodes.view'), ctrl.list);
router.get('/:id', requirePermission('queue_tree_nodes.view'), ctrl.get);
router.post('/', requirePermission('queue_tree_nodes.create'), validate(createQueueTreeNode), ctrl.create);
router.put('/:id', requirePermission('queue_tree_nodes.update'), validate(updateQueueTreeNode), ctrl.update);
router.delete('/:id', requirePermission('queue_tree_nodes.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('queue_tree_nodes.update'), ctrl.restore);

// Export MikroTik queue tree configuration script
router.get('/export/config', requirePermission('queue_tree_nodes.export'), async (req, res, next) => {
  try {
    const vendor = req.query.vendor || 'mikrotik';
    const result = await exportQueueTreeConfig(req.orgId, vendor);
    if (req.query.format === 'text') {
      res.set('Content-Type', 'text/plain');
      res.set('Content-Disposition', 'attachment; filename="queue-tree.rsc"');
      return res.send(result.script);
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
