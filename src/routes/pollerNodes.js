// =============================================================================
// FireISP 5.0 — Poller Node Routes (§6.4)
// =============================================================================
//
// GET    /poller-nodes              — list (requirePermission poller_nodes.view)
// POST   /poller-nodes              — create (INSTALL OPERATOR)
// GET    /poller-nodes/:id          — get by id (poller_nodes.view)
// PUT    /poller-nodes/:id          — update (INSTALL OPERATOR)
// DELETE /poller-nodes/:id          — delete (INSTALL OPERATOR)
// GET    /poller-nodes/:id/performance — performance history (poller_performance.view)
//
// A poller node is a CAPACITY UNIT OF THE DEPLOYMENT, not tenant data: you add
// one when a single box can no longer keep up with the clients and contracts on
// it (poller_nodes.node_identifier matches firerelay_nodes.id). There is no
// tenant that owns it, which is why the table has no organization_id and why
// scoping it per-org would be the wrong fix — it would mean every tenant
// needing their own poller, inverting the reason it exists.
//
// So the asymmetry is deliberate (j36): READS stay with technicians, who need
// to see poller health for the network they are working on, while WRITES belong
// to whoever runs the install. On a single-ISP box nothing changes — migration
// 444 makes every active admin the operator there. On a multi-tenant box it
// stops org A's technician deleting the poller that serves org B.
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
const { isInstallOperator, OPERATOR_ONLY_MESSAGE } = require('../services/installOperator');

const router = Router();
router.use(authenticate);
router.use(orgScope);

const ctrl = crudController(PollerNode);

/** Poller nodes are install infrastructure — see the header. */
async function requireInstallOperator(req, res, next) {
  try {
    if (await isInstallOperator(req)) return next();
    return res.status(403).json({
      error: { code: 'INSTALL_OPERATOR_ONLY', message: OPERATOR_ONLY_MESSAGE },
    });
  } catch (err) { return next(err); }
}

router.get('/',     requirePermission('poller_nodes.view'),   ctrl.list);
router.get('/:id',  requirePermission('poller_nodes.view'),   ctrl.get);
router.post('/',    requirePermission('poller_nodes.create'), requireInstallOperator, validate(createPollerNode), ctrl.create);
router.put('/:id',  requirePermission('poller_nodes.update'), requireInstallOperator, validate(updatePollerNode), ctrl.update);
router.delete('/:id', requirePermission('poller_nodes.delete'), requireInstallOperator, ctrl.destroy);

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
