// =============================================================================
// FireISP 5.0 — Refund Request Routes
// =============================================================================

const { Router } = require('express');
const RefundRequest = require('../models/RefundRequest');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createRefundRequestSchema,
  updateRefundRequestSchema,
  reviewRefundRequestSchema,
  processRefundRequestSchema,
} = require('../middleware/schemas/refundRequests');
const refundRequestService = require('../services/refundRequestService');

const router = Router();
const ctrl = crudController(RefundRequest);

router.use(authenticate);
router.use(orgScope);

// List refund requests
router.get('/', requirePermission('refund_requests.view'), ctrl.list);

// Get one refund request
router.get('/:id', requirePermission('refund_requests.view'), ctrl.get);

// Create a refund request
router.post('/', requirePermission('refund_requests.create'), validate(createRefundRequestSchema), async (req, res, next) => {
  try {
    const refundRequest = await refundRequestService.createRequest(
      req.orgId,
      req.body,
      req.user.id,
    );
    res.status(201).json({ data: refundRequest });
  } catch (err) {
    next(err);
  }
});

// Update non-status fields
router.put('/:id', requirePermission('refund_requests.create'), validate(updateRefundRequestSchema), async (req, res, next) => {
  try {
    const updated = await RefundRequest.update(req.params.id, req.body, req.orgId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Soft delete
router.delete('/:id', requirePermission('refund_requests.create'), ctrl.destroy);

// Review (approve / reject)
router.post('/:id/review', requirePermission('refund_requests.review'), validate(reviewRefundRequestSchema), async (req, res, next) => {
  try {
    const updated = await refundRequestService.reviewRequest(
      req.orgId,
      parseInt(req.params.id, 10),
      { status: req.body.status, review_notes: req.body.review_notes },
      req.user.id,
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// Process an approved refund request
router.post('/:id/process', requirePermission('refund_requests.process'), validate(processRefundRequestSchema), async (req, res, next) => {
  try {
    const updated = await refundRequestService.processRequest(
      req.orgId,
      parseInt(req.params.id, 10),
      { refund_method: req.body.refund_method, gateway_refund_reference: req.body.gateway_refund_reference },
      req.user.id,
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
