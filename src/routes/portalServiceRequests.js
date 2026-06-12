// =============================================================================
// FireISP 5.0 — Portal Service Requests Admin Routes (§11.3)
// =============================================================================
// Admin-side management of client self-service requests.
// Mounted at /api/v1/portal-service-requests (staff-facing, requires JWT + permission).
//
//   GET    /                   list requests (filters: status, request_type, client_id)
//   GET    /:id                request detail
//   POST   /:id/approve        approve + execute action (pppoe_password_change,
//                              plan_upgrade, wifi_password_change) or mark approved
//                              for manual types (static_ip_request, cancellation,
//                              visit_schedule)
//   POST   /:id/reject         reject with notes
//   POST   /:id/complete       mark an approved request as completed (manual fulfillment)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const portalServiceRequestService = require('../services/portalServiceRequestService');
const db = require('../config/database');

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const approveSchema = {
  notes: { type: 'string', max: 2000 },
};

const rejectSchema = {
  notes: { type: 'string', max: 2000 },
};

// ---------------------------------------------------------------------------
// All routes require authenticated staff JWT
// ---------------------------------------------------------------------------
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET / — list requests (admin)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /portal-service-requests:
 *   get:
 *     tags: [Portal]
 *     summary: List portal service requests (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, completed, cancelled]
 *       - in: query
 *         name: request_type
 *         schema:
 *           type: string
 *           enum: [plan_upgrade, wifi_password_change, pppoe_password_change,
 *                  static_ip_request, cancellation, visit_schedule]
 *       - in: query
 *         name: client_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: Paginated list of service requests
 */
router.get('/', requirePermission('portal_service_requests.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
    const { status, request_type: requestType, client_id: clientId } = req.query;

    const { rows, total } = await portalServiceRequestService.adminListRequests(
      req.orgId,
      { page, limit, status, requestType, clientId: clientId ? parseInt(clientId, 10) : undefined },
    );

    res.json({
      data: rows,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id — request detail
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /portal-service-requests/{id}:
 *   get:
 *     tags: [Portal]
 *     summary: Get a portal service request by id (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Service request detail
 *       404:
 *         description: Not found
 */
router.get('/:id', requirePermission('portal_service_requests.view'), async (req, res, next) => {
  try {
    const request = await portalServiceRequestService.adminGetRequest(
      parseInt(req.params.id, 10),
      req.orgId,
    );
    res.json({ data: request });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/approve — approve + execute
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /portal-service-requests/{id}/approve:
 *   post:
 *     tags: [Portal]
 *     summary: Approve a portal service request (admin)
 *     description: |
 *       Sets status to 'approved' and executes the corresponding action:
 *       - pppoe_password_change: syncs new password to RADIUS and marks completed
 *       - plan_upgrade: updates contract plan_id and marks completed
 *       - wifi_password_change: queues CPE TR-069 set-parameter task if device found,
 *         otherwise leaves approved for manual fulfillment
 *       - static_ip_request / cancellation / visit_schedule: stays approved for
 *         manual fulfillment; call POST /:id/complete when done
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request approved (and possibly completed)
 *       422:
 *         description: Request is not in pending status
 */
router.post(
  '/:id/approve',
  requirePermission('portal_service_requests.update'),
  validate(approveSchema),
  async (req, res, next) => {
    try {
      const result = await portalServiceRequestService.approveRequest(
        parseInt(req.params.id, 10),
        req.orgId,
        req.user.id,
        req.body.notes || null,
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/reject — reject with notes
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /portal-service-requests/{id}/reject:
 *   post:
 *     tags: [Portal]
 *     summary: Reject a portal service request (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request rejected
 *       422:
 *         description: Request is not in pending status
 */
router.post(
  '/:id/reject',
  requirePermission('portal_service_requests.update'),
  validate(rejectSchema),
  async (req, res, next) => {
    try {
      const result = await portalServiceRequestService.rejectRequest(
        parseInt(req.params.id, 10),
        req.orgId,
        req.body.notes || null,
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/complete — mark approved request as completed (manual fulfillment)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /portal-service-requests/{id}/complete:
 *   post:
 *     tags: [Portal]
 *     summary: Mark an approved portal service request as completed (admin)
 *     description: Used for request types requiring manual fulfillment (static_ip_request,
 *       cancellation, visit_schedule, or wifi_password_change without a CPE device).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Request marked as completed
 *       422:
 *         description: Request is not in approved status
 */
router.post(
  '/:id/complete',
  requirePermission('portal_service_requests.update'),
  async (req, res, next) => {
    try {
      const result = await portalServiceRequestService.completeRequest(
        parseInt(req.params.id, 10),
        req.orgId,
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /push-subscriptions — admin: list active push subscriptions for an org
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /portal-service-requests/push-subscriptions:
 *   get:
 *     tags: [Portal]
 *     summary: List active Web Push subscriptions (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: client_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: Paginated list of push subscriptions
 */
router.get('/push-subscriptions', requirePermission('portal_push.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
    const offset = (page - 1) * limit;
    const clientId = req.query.client_id ? parseInt(req.query.client_id, 10) : null;

    let where = 'WHERE pps.organization_id = ? AND pps.deleted_at IS NULL';
    const params = [req.orgId];

    if (clientId) {
      where += ' AND pps.client_id = ?';
      params.push(clientId);
    }

    const [rows] = await db.query(
      `SELECT pps.id, pps.client_id, pps.user_agent,
              pps.notify_outage, pps.notify_billing, pps.notify_ticket,
              pps.last_sent_at, pps.created_at, pps.updated_at,
              CONCAT(cl.first_name, ' ', cl.last_name) AS client_name
       FROM portal_push_subscriptions pps
       LEFT JOIN clients cl ON cl.id = pps.client_id
       ${where}
       ORDER BY pps.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM portal_push_subscriptions pps ${where}`,
      params,
    );
    res.json({ data: rows, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
