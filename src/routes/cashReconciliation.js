// =============================================================================
// FireISP 5.0 — Cash Reconciliation Routes
// =============================================================================

const { Router } = require('express');
const CashReconciliationSession = require('../models/CashReconciliationSession');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { openSessionSchema, closeSessionSchema } = require('../middleware/schemas/cashReconciliation');
const cashReconciliationService = require('../services/cashReconciliationService');

const router = Router();
const ctrl = crudController(CashReconciliationSession);

router.use(authenticate);
router.use(orgScope);

// Open a new session
router.post('/sessions', requirePermission('cash_reconciliation.create'), validate(openSessionSchema), async (req, res, next) => {
  try {
    const session = await cashReconciliationService.openSession({
      organizationId: req.orgId,
      agentUserId: req.user.id,
      notes: req.body.notes,
    });
    res.status(201).json({ data: session });
  } catch (err) {
    next(err);
  }
});

// List sessions
router.get('/sessions', requirePermission('cash_reconciliation.view'), ctrl.list);

// Get session detail with payments
router.get('/sessions/:id', requirePermission('cash_reconciliation.view'), async (req, res, next) => {
  try {
    const result = await cashReconciliationService.getSessionDetail(
      parseInt(req.params.id, 10),
      req.orgId,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Close session
router.post('/sessions/:id/close', requirePermission('cash_reconciliation.update'), validate(closeSessionSchema), async (req, res, next) => {
  try {
    const session = await cashReconciliationService.closeSession(
      parseInt(req.params.id, 10),
      req.orgId,
      req.body.counted_total,
    );
    res.json({ data: session });
  } catch (err) {
    next(err);
  }
});

// Approve session
router.post('/sessions/:id/approve', requirePermission('cash_reconciliation.approve'), async (req, res, next) => {
  try {
    const session = await cashReconciliationService.approveSession(
      parseInt(req.params.id, 10),
      req.orgId,
      req.user.id,
    );
    res.json({ data: session });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
