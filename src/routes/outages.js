// =============================================================================
// FireISP 5.0 — Outage Routes
// =============================================================================

const { Router } = require('express');
const Outage = require('../models/Outage');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createOutage, updateOutage } = require('../middleware/schemas/outages');
const eventBus = require('../services/eventBus');
const logger = require('../utils/logger').child({ service: 'routes/outages' });

const router = Router();

// Fire-and-forget: mirrors workOrders.js's emitAssigned pattern — never
// allowed to delay or fail the HTTP response. `outages` has no
// organization_id column of its own (scoped via device/site); the active
// request's org context (req.orgId, set by orgScope from X-Org-Id) is what
// the event bus/bell/email/webhook pipeline needs to route the notification.
function emitReported(organizationId, outage) {
  Promise.resolve(eventBus.emit('outage.reported', { organizationId, outage }))
    .catch(err => logger.warn({ err: err.message, outageId: outage.id }, 'outage.reported emit failed'));
}

function emitResolved(organizationId, outage) {
  Promise.resolve(eventBus.emit('outage.resolved', { organizationId, outage }))
    .catch(err => logger.warn({ err: err.message, outageId: outage.id }, 'outage.resolved emit failed'));
}

const ctrl = crudController(Outage, {
  afterCreate: async (record, req) => {
    emitReported(req.orgId, record);
  },
  // Stash the pre-update status so afterUpdate can tell whether this PUT is
  // the transition INTO 'resolved' (vs. e.g. an unrelated edit to an
  // already-resolved outage, which must NOT re-emit).
  beforeUpdate: async (old, req) => {
    req._priorOutageStatus = old.status;
  },
  afterUpdate: async (record, req) => {
    if (req._priorOutageStatus !== 'resolved' && record.status === 'resolved') {
      emitResolved(req.orgId, record);
    }
  },
});

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('outages.view'), ctrl.list);
router.get('/:id', requirePermission('outages.view'), ctrl.get);
router.post('/', requirePermission('outages.create'), validate(createOutage), ctrl.create);
router.put('/:id', requirePermission('outages.update'), validate(updateOutage), ctrl.update);
router.delete('/:id', requirePermission('outages.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('outages.update'), ctrl.restore);

module.exports = router;
