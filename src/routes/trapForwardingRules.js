// =============================================================================
// FireISP 5.0 — SNMP Trap Forwarding Rule Routes  §6.1
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { crudController } = require('../controllers/crudController');
const TrapForwardingRule = require('../models/TrapForwardingRule');
const { createTrapForwardingRule, updateTrapForwardingRule } = require('../middleware/schemas/trapForwardingRules');
const trapForwardingService = require('../services/trapForwardingService');
const db = require('../config/database');
const { AppError, NotFoundError } = require('../utils/errors');
const { trapForwardingTestLimiter } = require('../middleware/rateLimit');
const { checkSchemaReadiness } = require('../services/trapForwardingReadinessService');
const snmpTrapReceiver = require('../services/snmpTrapReceiver');

const SAFE_LIST_FILTERS = new Set([
  'id', 'name', 'match_trap_type', 'match_source_ip', 'match_oid_prefix', 'is_active',
]);
const SAFE_LIST_SORT_COLUMNS = new Set([
  'id', 'name', 'match_trap_type', 'match_source_ip', 'match_oid_prefix',
  'is_active', 'created_at', 'updated_at', 'last_delivery_status', 'last_delivery_at',
]);
const RULE_VALIDATION_PREFLIGHT = Symbol('trapForwardingRuleValidationPreflight');

const router = Router();
router.use(authenticate);
router.use(orgScope);
router.use((_req, _res, next) => (
  typeof db.withPrimaryContext === 'function'
    ? db.withPrimaryContext(() => next())
    : next()
));
router.use((_req, res, next) => {
  // Rule destinations can contain bearer tokens in their path/query. Even the
  // redacted view DTOs and delivery history are operationally sensitive, so
  // do not let browsers or intermediary caches retain any response here.
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
});

function maskEmail(raw) {
  const value = String(raw || '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return 'Invalid email destination';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function structurallySafeHttps(raw) {
  try {
    const url = new URL(String(raw));
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch (_) {
    return false;
  }
}

function sanitizeRuleAuditValues(values) {
  if (!values || typeof values !== 'object') return values;
  const sanitized = { ...values };
  for (const field of [
    'forward_to_url', 'forward_to_email', 'forward_to_webhook_id', 'transform_template',
  ]) {
    delete sanitized[field];
  }
  return sanitized;
}

function serializeRule(row, activeWebhooks = null) {
  if (!row || typeof row !== 'object') return row;
  const safe = { ...row };
  // The legacy column was a placeholder and was never executed. Do not accept
  // or echo template text as if it affected the privacy-minimal payload.
  delete safe.transform_template;

  const destinations = trapForwardingService.destinationsForRule(row);
  let targetType = null;
  let targetDisplayCode = 'review_destination';
  let targetNeedsAttention = destinations.length !== 1;

  if (destinations.length === 1) {
    const destination = destinations[0];
    targetType = destination.type;
    if (destination.type === 'url') {
      targetDisplayCode = 'direct_https_url';
      targetNeedsAttention = !structurallySafeHttps(destination.url);
    } else if (destination.type === 'email') {
      targetDisplayCode = 'email_recipient';
      targetNeedsAttention = maskEmail(destination.email) === 'Invalid email destination';
    } else {
      const webhook = activeWebhooks?.get(Number(destination.webhookId));
      // View-only rule rows never echo user-authored webhook descriptions or
      // IDs. The mutation-authorized destination chooser provides those.
      targetDisplayCode = 'registered_webhook';
      // Mutation responses do not need another lookup because their target was
      // validated immediately before the write. List/get pass a Map so stale,
      // missing, or disabled registered targets are visible to operators.
      targetNeedsAttention = activeWebhooks === null
        ? false
        : !webhook || !structurallySafeHttps(webhook.url);
    }
  }

  delete safe.forward_to_url;
  delete safe.forward_to_email;
  delete safe.forward_to_webhook_id;
  delete safe.configuration_reviewed_at;
  safe.is_active = Boolean(row.is_active);
  safe.last_delivery_is_test = Boolean(row.last_delivery_is_test);
  const configurationReviewed = Boolean(row.configuration_reviewed_at);
  return {
    ...safe,
    target_type: targetType,
    target_display: null,
    target_display_code: targetDisplayCode,
    target_needs_attention: targetNeedsAttention || !configurationReviewed,
    configuration_reviewed: configurationReviewed,
    transform_supported: false,
  };
}

async function markConfigurationReviewed(record, req, exec = db.query) {
  const reviewedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await exec(
    `UPDATE snmp_trap_forwarding_rules
        SET configuration_reviewed_at = ?
      WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
        AND BINARY match_trap_type <=> BINARY ? AND BINARY match_source_ip <=> BINARY ?
        AND BINARY match_oid_prefix <=> BINARY ? AND BINARY forward_to_url <=> BINARY ?
        AND BINARY forward_to_email <=> BINARY ? AND forward_to_webhook_id <=> ?
        AND is_active <=> ?`,
    [
      reviewedAt, record.id, req.orgId,
      record.match_trap_type ?? null, record.match_source_ip ?? null,
      record.match_oid_prefix ?? null, record.forward_to_url ?? null,
      record.forward_to_email ?? null, record.forward_to_webhook_id ?? null,
      record.is_active ? 1 : 0,
    ],
  );
  if (result && Number(result.affectedRows) !== 1) {
    throw new AppError(
      'The rule changed while it was being reviewed. Review and save it again.',
      409,
      'TRAP_FORWARDING_REVIEW_CONFLICT',
    );
  }
  record.configuration_reviewed_at = reviewedAt;
}

async function requireActivationReadiness(activating, exec = null) {
  if (!activating) return;
  const schema = await checkSchemaReadiness({ force: true, exec });
  const listener = snmpTrapReceiver.getStatus();
  let reason = null;
  if (!schema.primary?.ready) reason = 'primary_schema_unavailable';
  else if (!listener.ready) reason = ['feature_disabled', 'invalid_port', 'invalid_bind_ip', 'bind_failed']
    .includes(listener.reason)
    ? listener.reason
    : 'listener_not_ready';
  else if (!schema.ready) reason = schema.reason || 'source_attribution_unavailable';
  if (reason) {
    throw new AppError(
      'Trap forwarding cannot be enabled until receiver and source attribution are ready.',
      503,
      reason,
    );
  }
}

function assertValidationPreflight(req, lockedRule) {
  const preflight = req[RULE_VALIDATION_PREFLIGHT];
  if (!preflight
      || preflight.configuration !== trapForwardingService.ruleConfigurationFingerprint(lockedRule)) {
    throw new AppError(
      'The rule changed while its destination was being validated. Review and save it again.',
      409,
      'TRAP_FORWARDING_REVIEW_CONFLICT',
    );
  }
  return preflight;
}

async function prevalidateUpdate(req, _res, next) {
  try {
    // DNS is tenant-controlled and can consume the full bounded resolver
    // deadline. Perform it before checking a transaction connection out of the
    // pool, then bind the result to the exact row locked by beforeUpdate.
    const existing = await TrapForwardingRule.findByIdOrFail(req.params.id, req.orgId);
    const validation = {};
    await trapForwardingService.validateRuleInput(req.body, req.orgId, existing, {
      forceTargetValidation: true,
      validationResult: validation,
    });
    req[RULE_VALIDATION_PREFLIGHT] = {
      configuration: trapForwardingService.ruleConfigurationFingerprint(existing),
      destination: validation.destination,
    };
    next();
  } catch (err) {
    next(err);
  }
}

async function prevalidateRestore(req, _res, next) {
  try {
    const [rows] = await db.query(
      `SELECT * FROM snmp_trap_forwarding_rules
        WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL
        LIMIT 1`,
      [req.params.id, req.orgId],
    );
    const rule = rows[0];
    if (!rule) throw new NotFoundError('Trap forwarding rule');
    const validation = {};
    await trapForwardingService.validateRuleInput({}, req.orgId, rule, {
      forceTargetValidation: true,
      treatAsActivation: Boolean(rule.is_active),
      validationResult: validation,
    });
    req[RULE_VALIDATION_PREFLIGHT] = {
      configuration: trapForwardingService.ruleConfigurationFingerprint(rule),
      destination: validation.destination,
    };
    next();
  } catch (err) {
    next(err);
  }
}

const ctrl = crudController(TrapForwardingRule, {
  serialize: serializeRule,
  sanitizeAuditValues: sanitizeRuleAuditValues,
  beforeCreate: async (req) => {
    await requireActivationReadiness(req.body.is_active === undefined || req.body.is_active === true);
    await trapForwardingService.validateRuleInput(req.body, req.orgId);
    req.body.configuration_reviewed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  },
  beforeUpdate: async (existing, req, exec) => {
    const preflight = assertValidationPreflight(req, existing);
    const willBeActive = Object.prototype.hasOwnProperty.call(req.body, 'is_active')
      ? Boolean(req.body.is_active)
      : Boolean(existing.is_active);
    await requireActivationReadiness(!existing.is_active && willBeActive, exec);
    await trapForwardingService.validateRuleInput(req.body, req.orgId, existing, {
      forceTargetValidation: true,
      exec,
      skipNetworkValidation: true,
      prevalidatedDestination: preflight.destination,
    });
  },
  beforeRestore: async (req, exec) => {
    const [rows] = await exec(
      `SELECT * FROM snmp_trap_forwarding_rules
        WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL
        LIMIT 1 FOR UPDATE`,
      [req.params.id, req.orgId],
    );
    const rule = rows[0];
    if (!rule) throw new NotFoundError('Trap forwarding rule');
    const preflight = assertValidationPreflight(req, rule);
    await requireActivationReadiness(Boolean(rule.is_active), exec);
    await trapForwardingService.validateRuleInput({}, req.orgId, rule, {
      forceTargetValidation: true,
      treatAsActivation: Boolean(rule.is_active),
      exec,
      skipNetworkValidation: true,
      prevalidatedDestination: preflight.destination,
    });
  },
  afterUpdate: async (record, req, exec) => {
    await markConfigurationReviewed(record, req, exec);
  },
  afterRestore: async (record, req, exec) => {
    await markConfigurationReviewed(record, req, exec);
  },
  fatalAfterHooks: true,
  transactionalWrites: true,
  transactionalAfterHooks: true,
});

function safeWebhookDisplayUrl(raw) {
  try {
    const url = new URL(String(raw));
    // Incoming-webhook credentials often live in the PATH (Slack/Discord) as
    // well as the query string. The chooser needs the public origin only;
    // description + ID distinguish multiple registrations without disclosure.
    return url.origin;
  } catch (_) {
    return 'Invalid webhook URL';
  }
}

async function activeWebhookMapForRules(organizationId, rules) {
  const ids = [...new Set(rules
    .map(rule => Number(rule.forward_to_webhook_id))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT id, url, description
       FROM webhooks
      WHERE organization_id = ? AND is_active = 1 AND deleted_at IS NULL
        AND id IN (${placeholders})`,
    [organizationId, ...ids],
  );
  return new Map(rows.map(row => [Number(row.id), row]));
}

async function listSafeRules(req, res, next) {
  try {
    const {
      page: rawPage = 1,
      limit: rawLimit = 50,
      order_by: orderBy,
      order,
      include_deleted: includeDeleted,
      only_deleted: onlyDeleted,
      ...untrustedFilters
    } = req.query;
    // View DTOs hide destinations, so list filters and ordering must hide them
    // too. Otherwise exact filters or relative ordering become a side channel
    // for URL tokens, email recipients, webhook IDs, and organization IDs.
    const filters = Object.fromEntries(
      Object.entries(untrustedFilters).filter(([field]) => SAFE_LIST_FILTERS.has(field)),
    );
    const safeOrderBy = SAFE_LIST_SORT_COLUMNS.has(orderBy) ? orderBy : 'id';
    const page = Math.max(1, Number.parseInt(rawPage, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit, 10) || 50));
    const withDeleted = includeDeleted === 'true';
    const archivedOnly = onlyDeleted === 'true';
    const [rows, total] = await Promise.all([
      TrapForwardingRule.findAll({
        where: filters,
        orderBy: safeOrderBy,
        order: order || 'ASC',
        limit,
        offset: (page - 1) * limit,
        orgId: req.orgId,
        withDeleted,
        onlyDeleted: archivedOnly,
      }),
      TrapForwardingRule.count({
        where: filters,
        orgId: req.orgId,
        withDeleted,
        onlyDeleted: archivedOnly,
      }),
    ]);
    const activeWebhooks = await activeWebhookMapForRules(req.orgId, rows);
    res.json({
      data: rows.map(row => serializeRule(row, activeWebhooks)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

async function getSafeRule(req, res, next) {
  try {
    const rule = await TrapForwardingRule.findByIdOrFail(req.params.id, req.orgId);
    const activeWebhooks = await activeWebhookMapForRules(req.orgId, [rule]);
    res.json({ data: serializeRule(rule, activeWebhooks) });
  } catch (err) {
    next(err);
  }
}

// Static routes must precede /:id.
router.get('/readiness', requirePermission('trap_forwarding.view'), async (req, res, next) => {
  try {
    const schema = await checkSchemaReadiness();
    const listener = snmpTrapReceiver.getStatus();
    let reason = null;
    if (!schema.primary.ready) reason = 'primary_schema_unavailable';
    else if (listener.enabled === false) reason = 'feature_disabled';
    else if (!listener.ready) reason = ['invalid_port', 'invalid_bind_ip', 'bind_failed']
      .includes(listener.reason)
      ? listener.reason
      : 'listener_not_ready';
    else if (!schema.ready) reason = schema.reason;
    const ready = reason === null;
    const usage = schema.primary.ready
      ? await snmpTrapReceiver.getDailyIngestUsage(req.orgId).catch(() => null)
      : null;
    const ingest = usage?.organization || null;
    res.json({
      data: {
        ready,
        status: ready ? 'ready' : 'unavailable',
        reason,
        ingest,
      },
    });
  } catch (err) {
    next(err);
  }
});

// It deliberately uses create-or-update permission rather than webhooks.view
// so a technician can choose an existing destination
// without receiving its HMAC secret or query-string credentials.
router.get(
  '/destinations',
  requirePermission('trap_forwarding.create', 'trap_forwarding.update'),
  async (req, res, next) => {
    try {
      const [rows] = await db.query(
        `SELECT id, url, description
         FROM webhooks
        WHERE organization_id = ? AND is_active = 1 AND deleted_at IS NULL
        ORDER BY id ASC
        LIMIT 200`,
        [req.orgId],
      );
      res.json({
        data: rows.map(row => {
          const url = safeWebhookDisplayUrl(row.url);
          return {
            id: row.id,
            label: String(row.description || '').trim().slice(0, 120) || url,
            url,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

// Full destination values are confined to an edit-only endpoint. Normal
// list/get responses are safe for view-only technicians and never reveal a
// URL path/query token, full recipient address, or registered webhook ID.
router.get('/:id/configuration', requirePermission('trap_forwarding.update'), async (req, res, next) => {
  try {
    const rule = await TrapForwardingRule.findByIdOrFail(req.params.id, req.orgId);
    res.json({
      data: {
        id: rule.id,
        forward_to_url: rule.forward_to_url ?? null,
        forward_to_email: rule.forward_to_email ?? null,
        forward_to_webhook_id: rule.forward_to_webhook_id ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Safe operational history. Payloads and destination snapshots intentionally
// stay server-side because they may contain device topology or URL tokens.
router.get('/:id/deliveries', requirePermission('trap_forwarding.view'), async (req, res, next) => {
  try {
    await TrapForwardingRule.findByIdOrFail(req.params.id, req.orgId);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT id, trap_id, target_type, is_test, status, attempt_number,
              max_attempts, recovery_count, http_status_code, response_time_ms, last_error,
              next_attempt_at, delivered_at, created_at, updated_at
         FROM snmp_trap_forwarding_deliveries
        WHERE rule_id = ? AND organization_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      [req.params.id, req.orgId],
    );
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM snmp_trap_forwarding_deliveries
        WHERE rule_id = ? AND organization_id = ?`,
      [req.params.id, req.orgId],
    );
    const total = Number(countRow?.total || 0);
    res.json({
      data: rows.map(row => ({ ...row, is_test: Boolean(row.is_test) })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/test', trapForwardingTestLimiter, requirePermission('trap_forwarding.update'), async (req, res, next) => {
  try {
    const rule = await TrapForwardingRule.findByIdOrFail(req.params.id, req.orgId);
    // Revalidate at action time. This catches a registered webhook that was
    // disabled or a DNS destination that changed after the rule was saved.
    // Complete DNS before queueTestDelivery checks out and locks a transaction
    // connection; the service binds this result to the exact locked row.
    const validation = {};
    await trapForwardingService.validateRuleInput({}, req.orgId, rule, {
      forceTargetValidation: true,
      validationResult: validation,
    });
    const delivery = await trapForwardingService.queueTestDelivery(rule, req.orgId, {
      prevalidatedDestination: validation.destination,
      prevalidatedConfiguration: trapForwardingService.ruleConfigurationFingerprint(rule),
    });
    res.status(202).json({ data: delivery });
  } catch (err) {
    next(err);
  }
});

router.get('/',     requirePermission('trap_forwarding.view'),   listSafeRules);
router.get('/:id',  requirePermission('trap_forwarding.view'),   getSafeRule);
router.post('/',    requirePermission('trap_forwarding.create'),  validate(createTrapForwardingRule, { strip: true }), ctrl.create);
router.put('/:id',  requirePermission('trap_forwarding.update'),  validate(updateTrapForwardingRule, { strip: true }), prevalidateUpdate, ctrl.update);
router.delete('/:id', requirePermission('trap_forwarding.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('trap_forwarding.update'), prevalidateRestore, ctrl.restore);

module.exports = router;
