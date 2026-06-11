// =============================================================================
// FireISP 5.0 — Poller Node Routes (§6.4)
// =============================================================================
//
// GET    /poller-nodes              — list (requirePermission poller_nodes.view)
// POST   /poller-nodes              — create (poller_nodes.create)
// GET    /poller-nodes/:id          — get by id (poller_nodes.view)
// PUT    /poller-nodes/:id          — update (poller_nodes.update)
// DELETE /poller-nodes/:id          — delete (poller_nodes.delete)
// GET    /poller-nodes/:id/performance — performance history (poller_performance.view)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { crudController } = require('../controllers/crudController');
const PollerNode = require('../models/PollerNode');
const { createPollerNode, updatePollerNode } = require('../middleware/schemas/pollerNodes');
const pollerEngine = require('../services/pollerEngine');

const router = Router();
router.use(authenticate);
router.use(orgScope);

const ctrl = crudController(PollerNode);

router.get('/',     requirePermission('poller_nodes.view'),   ctrl.list);
router.get('/:id',  requirePermission('poller_nodes.view'),   ctrl.get);
router.post('/',    requirePermission('poller_nodes.create'),  validate(createPollerNode), ctrl.create);
router.put('/:id',  requirePermission('poller_nodes.update'),  validate(updatePollerNode), ctrl.update);
router.delete('/:id', requirePermission('poller_nodes.delete'), ctrl.destroy);

// Performance history for a specific poller node
router.get('/:id/performance', requirePermission('poller_performance.view'), async (req, res, next) => {
  try {
    const nodeId = parseInt(req.params.id, 10);
    if (!nodeId || Number.isNaN(nodeId)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'id must be an integer' } });
    }

    const hours = req.query.hours || 24;
    const rows = await pollerEngine.getPerformanceDashboard(nodeId, hours);
    res.json({ data: rows, meta: { node_id: nodeId, hours: parseInt(hours, 10) || 24 } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
