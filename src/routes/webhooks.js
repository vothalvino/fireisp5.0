// =============================================================================
// FireISP 5.0 — Webhook Routes
// =============================================================================

const { Router } = require('express');
const Webhook = require('../models/Webhook');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createWebhook, updateWebhook } = require('../middleware/schemas/webhooks');
const webhookService = require('../services/webhookService');
const { assertSafeOutboundUrl } = require('../utils/safeOutboundUrl');
const { AppError } = require('../utils/errors');

const router = Router();
const SAFE_LIST_FILTERS = new Set([
  'id', 'events', 'max_retries', 'timeout_seconds', 'is_active',
]);
const SAFE_LIST_SORT_COLUMNS = new Set([
  'id', 'events', 'max_retries', 'timeout_seconds', 'is_active',
  'created_at', 'updated_at',
]);

// Never expose the webhook's HMAC signing secret in any response body. Per
// The UI only needs to know whether an encrypted secret is configured, not its
// value. Mirrors
// src/routes/paymentGateways.js's redact.
function redactWebhook(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  const hasSecret = Boolean(rest.secret_encrypted);
  delete rest.secret_encrypted;
  delete rest.url;
  return {
    ...rest,
    has_secret: hasSecret,
    is_active: Boolean(rest.is_active),
    url_configured: Boolean(row.url),
    target_display_code: 'configured_https_endpoint',
  };
}

function sanitizeWebhookAuditValues(values) {
  if (!values || typeof values !== 'object') return values;
  const sanitized = { ...values };
  for (const field of ['url', 'secret', 'secret_encrypted']) delete sanitized[field];
  return sanitized;
}

const ctrl = crudController(Webhook, {
  serialize: redactWebhook,
  sanitizeAuditValues: sanitizeWebhookAuditValues,
  beforeCreate: async (req) => {
    req.body.url = await assertSafeOutboundUrl(req.body.url, 'webhook URL');
  },
  beforeUpdate: async (existing, req) => {
    const candidate = Object.prototype.hasOwnProperty.call(req.body, 'url')
      ? req.body.url
      : existing.url;
    const normalized = await assertSafeOutboundUrl(candidate, 'webhook URL');
    if (Object.prototype.hasOwnProperty.call(req.body, 'url')) req.body.url = normalized;
  },
  beforeRestore: async (req, exec) => {
    const [rows] = await exec(
      `SELECT id, organization_id, url
         FROM webhooks
        WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL
        FOR UPDATE`,
      [req.params.id, req.orgId],
    );
    const row = rows[0];
    if (!row || Number(row.organization_id) !== Number(req.orgId)) {
      throw new AppError('Webhook not found.', 404, 'NOT_FOUND');
    }
    await assertSafeOutboundUrl(row.url, 'webhook URL');
  },
});

async function listSafeWebhooks(req, res, next) {
  try {
    const {
      page: rawPage = 1,
      limit: rawLimit = 50,
      order_by: requestedOrderBy,
      order,
      include_deleted: includeDeleted,
      only_deleted: onlyDeleted,
      ...untrustedFilters
    } = req.query;
    // The view DTO deliberately hides URL and encrypted-secret columns. Do
    // not re-expose them as equality or ordering oracles through BaseModel's
    // generic fillable-column query support.
    const filters = Object.fromEntries(
      Object.entries(untrustedFilters).filter(([field]) => SAFE_LIST_FILTERS.has(field)),
    );
    const orderBy = SAFE_LIST_SORT_COLUMNS.has(requestedOrderBy) ? requestedOrderBy : 'id';
    const page = Math.max(1, Number.parseInt(rawPage, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit, 10) || 50));
    const withDeleted = includeDeleted === 'true';
    const archivedOnly = onlyDeleted === 'true';
    const [rows, total] = await Promise.all([
      Webhook.findAll({
        where: filters,
        orderBy,
        order: order || 'ASC',
        limit,
        offset: (page - 1) * limit,
        orgId: req.orgId,
        withDeleted,
        onlyDeleted: archivedOnly,
      }),
      Webhook.count({
        where: filters,
        orgId: req.orgId,
        withDeleted,
        onlyDeleted: archivedOnly,
      }),
    ]);
    res.json({
      data: rows.map(redactWebhook),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

router.use(authenticate);
router.use(orgScope);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
});

router.get('/', requirePermission('webhooks.view'), listSafeWebhooks);

// List dead-letter deliveries for this organization
// NOTE: static GET paths must be registered before GET /:id so they are not
// captured as an :id param.
router.get('/dead-letters', requirePermission('webhooks.view'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const items = await webhookService.listDeadLetters(req.orgId, limit);
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/configuration', requirePermission('webhooks.update'), async (req, res, next) => {
  try {
    const webhook = await Webhook.findByIdOrFail(req.params.id, req.orgId);
    res.json({ data: { id: webhook.id, url: webhook.url } });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('webhooks.view'), ctrl.get);
router.post('/', requirePermission('webhooks.create'), validate(createWebhook, { strip: true }), ctrl.create);
router.put('/:id', requirePermission('webhooks.update'), validate(updateWebhook, { strip: true }), ctrl.update);
router.delete('/:id', requirePermission('webhooks.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('webhooks.update'), ctrl.restore);

// Re-deliver a dead-letter delivery by its ID
router.post('/deliveries/:deliveryId/redeliver', requirePermission('webhooks.update'), async (req, res, next) => {
  try {
    const result = await webhookService.redeliverDeadLetter(Number(req.params.deliveryId), req.orgId);
    if (result.status === 'not_found') {
      return res.status(404).json({ message: 'Dead-letter delivery not found' });
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// List recent webhook deliveries for a specific webhook
router.get('/:id/deliveries', requirePermission('webhooks.view'), async (req, res, next) => {
  try {
    const deliveries = await Webhook.getDeliveries(req.params.id, req.orgId);
    res.json({ data: deliveries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
