// =============================================================================
// FireISP 5.0 — Communication Campaign Routes — §1.4
// =============================================================================

const { Router } = require('express');
const CommunicationCampaign = require('../models/CommunicationCampaign');
const CampaignMessage = require('../models/CampaignMessage');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createCommunicationCampaign,
  updateCommunicationCampaign,
  patchCommunicationCampaign,
} = require('../middleware/schemas/communicationCampaigns');
const campaignService = require('../services/campaignService');

const router = Router();
const ctrl = crudController(CommunicationCampaign, { cacheResource: 'communication-campaigns' });

router.use(authenticate);
router.use(orgScope);

/**
 * @openapi
 * /communication-campaigns:
 *   get:
 *     summary: List communication campaigns
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Org-Id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated list of campaigns
 */
router.get('/', requirePermission('campaigns.view'), ctrl.list);

/**
 * @openapi
 * /communication-campaigns/{id}:
 *   get:
 *     summary: Get a communication campaign by ID
 *     tags: [Communication]
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
 *         description: Campaign data
 *       404:
 *         description: Not found
 */
router.get('/:id', requirePermission('campaigns.view'), ctrl.get);

/**
 * @openapi
 * /communication-campaigns:
 *   post:
 *     summary: Create a communication campaign
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, channel]
 *             properties:
 *               name:
 *                 type: string
 *               channel:
 *                 type: string
 *                 enum: [email, sms, whatsapp]
 *               template_id:
 *                 type: integer
 *               filter_status:
 *                 type: string
 *               filter_plan_id:
 *                 type: integer
 *               filter_tag:
 *                 type: string
 *               scheduled_at:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Campaign created
 */
router.post(
  '/',
  requirePermission('campaigns.create'),
  validate(createCommunicationCampaign),
  (req, _res, next) => {
    // Default status to 'draft' on creation
    req.body.status = 'draft';
    if (req.user?.id) req.body.created_by = req.user.id;
    next();
  },
  ctrl.create,
);

/**
 * @openapi
 * /communication-campaigns/{id}:
 *   put:
 *     summary: Update a communication campaign
 *     tags: [Communication]
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
 *         description: Updated campaign
 */
router.put(
  '/:id',
  requirePermission('campaigns.update'),
  validate(updateCommunicationCampaign),
  ctrl.update,
);

/**
 * @openapi
 * /communication-campaigns/{id}:
 *   patch:
 *     summary: Partially update a communication campaign
 *     tags: [Communication]
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
 *         description: Updated campaign
 */
router.patch(
  '/:id',
  requirePermission('campaigns.update'),
  validate(patchCommunicationCampaign),
  ctrl.partialUpdate,
);

/**
 * @openapi
 * /communication-campaigns/{id}:
 *   delete:
 *     summary: Soft-delete a communication campaign
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/:id', requirePermission('campaigns.delete'), ctrl.destroy);

/**
 * @openapi
 * /communication-campaigns/{id}/restore:
 *   post:
 *     summary: Restore a soft-deleted campaign
 *     tags: [Communication]
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
 *         description: Restored campaign
 */
router.post('/:id/restore', requirePermission('campaigns.update'), ctrl.restore);

/**
 * @openapi
 * /communication-campaigns/{id}/dispatch:
 *   post:
 *     summary: Dispatch a campaign — builds recipient list and queues messages
 *     tags: [Communication]
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
 *         description: Campaign dispatched
 *       409:
 *         description: Campaign already in a non-dispatchable state
 */
router.post('/:id/dispatch', requirePermission('campaigns.update'), async (req, res, next) => {
  try {
    const result = await campaignService.dispatchCampaign(
      parseInt(req.params.id, 10),
      req.orgId,
    );
    res.json({ data: result });
  } catch (err) {
    // Surface "cannot dispatch from status" as a 409
    if (err.message && err.message.includes('cannot be dispatched')) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: err.message } });
    }
    next(err);
  }
});

/**
 * @openapi
 * /communication-campaigns/{id}/messages:
 *   get:
 *     summary: List per-recipient messages for a campaign
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [queued, sent, delivered, opened, bounced, failed]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated list of campaign messages
 */
router.get('/:id/messages', requirePermission('campaigns.view'), async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const { page = 1, limit = 50, status } = req.query;

    const where = { campaign_id: campaignId };
    if (status) where.status = status;

    const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * safeLimit;

    const [rows, total] = await Promise.all([
      CampaignMessage.findAll({
        where,
        orderBy: 'id',
        order: 'ASC',
        limit: safeLimit,
        offset,
        orgId: req.orgId,
      }),
      CampaignMessage.count({ where, orgId: req.orgId }),
    ]);

    res.json({
      data: rows,
      meta: {
        total,
        page: parseInt(page, 10),
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
