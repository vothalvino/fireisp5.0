// =============================================================================
// FireISP 5.0 — durable SNMP trap forwarding
// =============================================================================
// A received trap is stored first. forwardTrap() then evaluates tenant-scoped
// rules and persists immutable delivery jobs containing only allowlisted trap
// metadata. Network/email I/O happens asynchronously; failures never roll back
// or discard the inbound trap.
// =============================================================================

const crypto = require('crypto');
const net = require('net');
const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'trapForwarding' });
const emailTransport = require('./emailTransport');
const jobQueue = require('./jobQueueService');
const { AppError } = require('../utils/errors');
const { assertSafeOutboundUrl } = require('../utils/safeOutboundUrl');
const {
  safeHttpsPost,
  WEBHOOK_ABSOLUTE_TIMEOUT_MS,
} = require('../utils/safeHttpsPost');
const { normalizeIpAddress } = require('../utils/ipAddress');
const { decrypt } = require('../utils/encryption');
const { checkSchemaReadiness } = require('./trapForwardingReadinessService');

const MAX_ACTIVE_RULES = 100;
const DEFAULT_MAX_ATTEMPTS = 4;
const MAX_RETRY_BATCH = 100;
const REQUEST_TIMEOUT_MS = WEBHOOK_ABSOLUTE_TIMEOUT_MS;
const EMAIL_DELIVERY_TIMEOUT_MS = 60000;
const PROCESSING_STALE_MINUTES = 5;
const MAX_AMBIGUOUS_RECOVERIES = 1;
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const TARGET_FIELDS = ['forward_to_url', 'forward_to_email', 'forward_to_webhook_id'];
const NORMALIZED_TEXT_FIELDS = [
  'name', 'match_trap_type', 'match_source_ip', 'match_oid_prefix',
  'forward_to_url', 'forward_to_email',
];

function isStableAttributionPolicyFailure(reason) {
  return reason === 'isolated_tenant_attribution_unsupported'
    || reason === 'multi_organization_attribution_unsupported';
}

function truncate(value, max = 500) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) || null;
}

function normalizeOid(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().replace(/^\.+|\.+$/g, '') || null;
}

function normalizeIp(value) {
  return normalizeIpAddress(value);
}

function normalizeRuleData(data) {
  for (const field of NORMALIZED_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    if (data[field] === null) continue;
    const value = String(data[field]).trim();
    data[field] = value || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'match_oid_prefix')) {
    data.match_oid_prefix = normalizeOid(data.match_oid_prefix);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'match_source_ip')) {
    data.match_source_ip = normalizeIp(data.match_source_ip);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'forward_to_webhook_id')
      && (data.forward_to_webhook_id === '' || data.forward_to_webhook_id === null)) {
    data.forward_to_webhook_id = null;
  }
  return data;
}

// Stable representation of every field that can change matching, routing, or
// the operator-visible test payload. It binds slow pre-transaction network
// validation to the exact row subsequently locked and written.
function ruleConfigurationFingerprint(rule) {
  const normalized = normalizeRuleData({ ...(rule || {}) });
  return JSON.stringify([
    Number(normalized.id) || null,
    Number(normalized.organization_id) || null,
    normalized.name ?? null,
    normalized.match_trap_type ?? null,
    normalized.match_source_ip ?? null,
    normalized.match_oid_prefix ?? null,
    normalized.forward_to_url ?? null,
    normalized.forward_to_email ?? null,
    normalized.forward_to_webhook_id === null || normalized.forward_to_webhook_id === undefined
      ? null
      : Number(normalized.forward_to_webhook_id),
    Boolean(normalized.is_active),
    normalized.deleted_at ? String(normalized.deleted_at) : null,
    normalized.configuration_reviewed_at ? String(normalized.configuration_reviewed_at) : null,
  ]);
}

function destinationsForRule(rule) {
  const destinations = [];
  if (rule.forward_to_url) destinations.push({ type: 'url', url: String(rule.forward_to_url) });
  if (rule.forward_to_email) destinations.push({ type: 'email', email: String(rule.forward_to_email) });
  if (rule.forward_to_webhook_id !== null && rule.forward_to_webhook_id !== undefined && rule.forward_to_webhook_id !== '') {
    destinations.push({ type: 'webhook', webhookId: Number(rule.forward_to_webhook_id) });
  }
  return destinations;
}

function outboundValidationConflict() {
  return new AppError(
    'The forwarding destination changed while it was being validated. Review and save it again.',
    409,
    'TRAP_FORWARDING_REVIEW_CONFLICT',
  );
}

function normalizedUrlIdentity(raw) {
  try {
    return new URL(String(raw)).toString();
  } catch (_) {
    return null;
  }
}

function assertPrevalidatedDestination(actual, prevalidated) {
  if (!prevalidated || actual.type !== prevalidated.type) {
    throw outboundValidationConflict();
  }
  if (actual.type === 'url'
      && normalizedUrlIdentity(actual.url) !== prevalidated.url) {
    throw outboundValidationConflict();
  }
  if (actual.type === 'email' && actual.email !== prevalidated.email) {
    throw outboundValidationConflict();
  }
  if (actual.type === 'webhook'
      && (Number(actual.webhookId) !== Number(prevalidated.webhookId)
        || normalizedUrlIdentity(actual.url) !== prevalidated.url)) {
    throw outboundValidationConflict();
  }
}

function assertMatcherFormats(rule) {
  if (rule.match_source_ip && net.isIP(rule.match_source_ip) !== 4) {
    throw new AppError('Match source IP must be a valid IPv4 address.', 422, 'INVALID_TRAP_MATCHER');
  }
  if (rule.match_oid_prefix && !/^\d+(?:\.\d+)*$/.test(rule.match_oid_prefix)) {
    throw new AppError('Match OID prefix must be a dotted numeric OID.', 422, 'INVALID_TRAP_MATCHER');
  }
  if (rule.match_trap_type && !/^[A-Za-z0-9_.:-]+$/.test(rule.match_trap_type)) {
    throw new AppError('Match trap type may contain letters, numbers, dot, underscore, colon, or hyphen.', 422, 'INVALID_TRAP_MATCHER');
  }
}

async function getActiveWebhook(organizationId, webhookId, exec = db.query) {
  if (!config.features.webhooks) return null;
  const [rows] = await exec(
    `SELECT id, organization_id, url, description, secret_encrypted,
            max_retries, timeout_seconds
       FROM webhooks
      WHERE organization_id = ? AND id = ? AND is_active = 1
        AND deleted_at IS NULL
      LIMIT 1`,
    [organizationId, webhookId],
  );
  const webhook = rows[0];
  if (!webhook
      || Number(webhook.id) !== Number(webhookId)
      || Number(webhook.organization_id) !== Number(organizationId)) return null;
  return webhook;
}

async function getOrganizationDeliveryState(organizationId, exec = db.query) {
  const [rows] = await exec(
    `SELECT id, status, deleted_at, outbound_delivery_epoch
       FROM organizations
      WHERE id = ?
      LIMIT 1`,
    [organizationId],
  );
  const row = rows[0] || null;
  if (!row || Number(row.id) !== Number(organizationId)) return null;
  return {
    active: row.status === 'active' && !row.deleted_at,
    epoch: Number(row.outbound_delivery_epoch || 0),
  };
}

async function enforceActiveRuleLimit(organizationId, existing, combined, options = {}) {
  const willBeActive = combined.is_active === undefined ? true : Boolean(combined.is_active);
  const wasActive = options.treatAsActivation ? false : (existing ? Boolean(existing.is_active) : false);
  if (!willBeActive || wasActive) return;

  const params = [organizationId];
  let exclusion = '';
  if (existing?.id) {
    exclusion = ' AND id <> ?';
    params.push(existing.id);
  }
  const exec = options.exec || db.query;
  const [[row]] = await exec(
    `SELECT COUNT(*) AS total
       FROM snmp_trap_forwarding_rules
      WHERE organization_id = ? AND is_active = 1 AND deleted_at IS NULL${exclusion}`,
    params,
  );
  if (Number(row?.total || 0) >= MAX_ACTIVE_RULES) {
    throw new AppError(
      `An organization may have at most ${MAX_ACTIVE_RULES} active trap forwarding rules. Pause one before enabling another.`,
      422,
      'TRAP_FORWARDING_RULE_LIMIT',
    );
  }
}

/**
 * Normalize and validate create/update data. For updates the submitted fields
 * are merged with the existing row, so a normal partial edit retains its one
 * destination while a target switch must explicitly clear the previous one.
 */
async function validateRuleInput(data, organizationId, existing = null, options = {}) {
  normalizeRuleData(data);
  const combined = normalizeRuleData({ ...(existing || {}), ...data });
  assertMatcherFormats(combined);

  const destinations = destinationsForRule(combined);
  if (destinations.length !== 1) {
    throw new AppError(
      'Choose exactly one destination: secure URL, email address, or registered webhook.',
      422,
      'TRAP_FORWARDING_DESTINATION_REQUIRED',
    );
  }

  const destination = destinations[0];
  const destinationTouched = !existing
    || TARGET_FIELDS.some(field => Object.prototype.hasOwnProperty.call(data, field))
    || (!existing?.is_active && Boolean(combined.is_active))
    || options.forceTargetValidation === true;
  if (destination.type === 'email') {
    if (!EMAIL_RE.test(destination.email) || destination.email.length > 255) {
      throw new AppError('Forwarding email must be a valid email address.', 422, 'INVALID_TRAP_FORWARDING_EMAIL');
    }
    data.forward_to_email = destination.email;
    if (options.skipNetworkValidation) {
      assertPrevalidatedDestination(destination, options.prevalidatedDestination);
    }
    if (options.validationResult) {
      options.validationResult.destination = { type: 'email', email: destination.email };
    }
  } else if (destination.type === 'url') {
    let normalizedUrl = destination.url;
    if (destinationTouched) {
      if (options.skipNetworkValidation) {
        normalizedUrl = normalizedUrlIdentity(destination.url);
        assertPrevalidatedDestination(
          { type: 'url', url: destination.url },
          options.prevalidatedDestination,
        );
      } else {
        normalizedUrl = await assertSafeOutboundUrl(destination.url, 'forward_to_url');
      }
    }
    // Only rewrite the submitted field; a partial edit should not manufacture
    // an UPDATE for an unchanged URL.
    if (Object.prototype.hasOwnProperty.call(data, 'forward_to_url')) data.forward_to_url = normalizedUrl;
    if (options.validationResult) {
      options.validationResult.destination = {
        type: 'url',
        url: normalizedUrlIdentity(normalizedUrl),
      };
    }
  } else {
    if (!Number.isSafeInteger(destination.webhookId) || destination.webhookId < 1) {
      throw new AppError('Registered webhook must be a positive integer ID.', 422, 'INVALID_TRAP_FORWARDING_WEBHOOK');
    }
    let validatedWebhookUrl = null;
    if (destinationTouched) {
      const webhook = await getActiveWebhook(
        organizationId,
        destination.webhookId,
        options.exec || db.query,
      );
      if (!webhook) {
        throw new AppError('Registered webhook was not found or is not active for this organization.', 422, 'INVALID_TRAP_FORWARDING_WEBHOOK');
      }
      // A registered webhook is still tenant-controlled. Reuse the exact same
      // SSRF policy instead of trusting it merely because it has a database row.
      if (options.skipNetworkValidation) {
        validatedWebhookUrl = normalizedUrlIdentity(webhook.url);
        assertPrevalidatedDestination(
          { type: 'webhook', webhookId: destination.webhookId, url: webhook.url },
          options.prevalidatedDestination,
        );
      } else {
        validatedWebhookUrl = await assertSafeOutboundUrl(webhook.url, 'registered webhook URL');
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, 'forward_to_webhook_id')) {
      data.forward_to_webhook_id = destination.webhookId;
    }
    if (options.validationResult) {
      options.validationResult.destination = {
        type: 'webhook',
        webhookId: destination.webhookId,
        url: normalizedUrlIdentity(validatedWebhookUrl),
      };
    }
  }

  await enforceActiveRuleLimit(organizationId, existing, combined, options);
  return data;
}

/** Match null criteria as wildcards and AND every populated criterion. */
function matchesRule(rule, trap) {
  if (!rule || !trap) return false;
  if (rule.match_trap_type && String(trap.trapType ?? trap.trap_type ?? '') !== String(rule.match_trap_type)) {
    return false;
  }
  if (rule.match_source_ip
      && normalizeIp(trap.sourceIp ?? trap.source_ip) !== normalizeIp(rule.match_source_ip)) {
    return false;
  }
  if (rule.match_oid_prefix) {
    const prefix = normalizeOid(rule.match_oid_prefix);
    const oid = normalizeOid(trap.trapOid ?? trap.trap_oid);
    if (!oid || !prefix || (oid !== prefix && !oid.startsWith(`${prefix}.`))) return false;
  }
  return true;
}

/** Build the complete outbound allowlist. Never include community or varbind values. */
function buildForwardPayload(trap, device = null) {
  return {
    event: 'snmp.trap',
    organization_id: trap.organizationId ?? trap.organization_id ?? null,
    trap: {
      id: trap.trapId ?? trap.id ?? null,
      source_ip: normalizeIp(trap.sourceIp ?? trap.source_ip) || 'unknown',
      type: String(trap.trapType ?? trap.trap_type ?? 'unknown').slice(0, 64),
      oid: normalizeOid(trap.trapOid ?? trap.trap_oid),
      snmp_version: Number(trap.snmpVersion ?? trap.snmp_version ?? 0) || null,
      received_at: trap.receivedAt ?? trap.received_at ?? new Date().toISOString(),
    },
    device: device ? {
      id: device.id ?? null,
      name: String(device.name || '').slice(0, 255) || null,
    } : null,
  };
}

function buildTestPayload(rule, organizationId) {
  return {
    event: 'snmp.trap.test',
    test: true,
    organization_id: organizationId,
    rule: { id: rule.id, name: String(rule.name || '').slice(0, 200) },
    sent_at: new Date().toISOString(),
  };
}

async function resolveDestinationSnapshot(rule, organizationId, exec = db.query) {
  const destinations = destinationsForRule(rule);
  if (destinations.length !== 1) return null; // fail closed for invalid legacy rows
  const destination = destinations[0];
  if (destination.type !== 'webhook') return destination;
  if (!Number.isSafeInteger(destination.webhookId) || destination.webhookId < 1) return null;
  const webhook = await getActiveWebhook(organizationId, destination.webhookId, exec);
  if (!webhook) return null;
  return {
    type: 'webhook',
    webhookId: webhook.id,
    url: webhook.url,
    maxAttempts: Math.min(11, Math.max(1, Number(webhook.max_retries ?? 3) + 1)),
  };
}

async function updateRuleSummary(
  ruleId,
  organizationId,
  status,
  error = null,
  isTest = false,
  exec = db.query,
) {
  if (!ruleId) return;
  await exec(
    `UPDATE snmp_trap_forwarding_rules
        SET last_delivery_status = ?, last_delivery_at = NOW(),
            last_error = ?, last_delivery_is_test = ?
      WHERE id = ? AND organization_id = ?`,
    [status, truncate(error, 500), isTest ? 1 : 0, ruleId, organizationId],
  ).catch(err => logger.warn({ err, ruleId, organizationId }, 'Could not update trap forwarding rule summary'));
}

async function insertDelivery({
  rule,
  organizationId,
  organizationEpoch = null,
  trapId = null,
  destination,
  payload,
  isTest = false,
  exec = db.query,
}) {
  let epoch = organizationEpoch;
  if (epoch === null || epoch === undefined
      || !Number.isSafeInteger(Number(epoch)) || Number(epoch) < 0) {
    const owner = await getOrganizationDeliveryState(organizationId, exec);
    if (!owner?.active) {
      throw new AppError('The owning organization is suspended or deleted.', 409, 'ORGANIZATION_INACTIVE');
    }
    epoch = owner.epoch;
  }
  const maxAttempts = destination.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  let result;
  try {
    [result] = await exec(
      `INSERT INTO snmp_trap_forwarding_deliveries
         (organization_id, organization_epoch, rule_id, trap_id, webhook_id, target_type,
          target_url, target_email, payload, is_test, status,
          attempt_number, max_attempts, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NOW())`,
      [
        organizationId,
        Number(epoch),
        rule.id,
        trapId,
        destination.type === 'webhook' ? destination.webhookId : null,
        destination.type,
        destination.type === 'url' || destination.type === 'webhook' ? destination.url : null,
        destination.type === 'email' ? destination.email : null,
        JSON.stringify(payload),
        isTest ? 1 : 0,
        maxAttempts,
      ],
    );
  } catch (err) {
    // The same stored trap may be handed to forwardTrap more than once after a
    // process restart or upstream retry. The database key is authoritative:
    // return the already-durable row instead of creating a second real send.
    // Synthetic tests intentionally have trap_id=NULL and remain repeatable.
    const duplicate = err?.code === 'ER_DUP_ENTRY' || Number(err?.errno) === 1062;
    if (!duplicate || trapId === null || trapId === undefined) throw err;
    const [rows] = await exec(
      `SELECT id
         FROM snmp_trap_forwarding_deliveries
        WHERE organization_id = ? AND rule_id = ? AND trap_id = ?
        LIMIT 1`,
      [organizationId, rule.id, trapId],
    );
    if (!rows[0]) throw err;
    return { id: rows[0].id, created: false };
  }
  await updateRuleSummary(rule.id, organizationId, 'pending', null, isTest, exec);
  return { id: result.insertId, created: true };
}

async function enqueueDeliveryJob(deliveryId, organizationId) {
  return jobQueue.add('trap-forwarding-delivery', { deliveryId, organizationId }, {
    jobId: `trap-forwarding-${organizationId}-${deliveryId}`,
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/**
 * Persist deliveries for all matching active rules, then enqueue asynchronous
 * attempts. Every rule is isolated: one invalid/missing destination cannot stop
 * another rule, and no error is allowed to affect the already-stored trap.
 */
async function prepareTrapDeliveries(trap, device = null, options = {}) {
  const exec = options.exec || db.query;
  const atomic = options.atomic === true;
  const organizationId = trap?.organizationId ?? trap?.organization_id;
  if (!config.features.snmp || !organizationId || !device) {
    return {
      matched_rules: 0,
      queued_deliveries: 0,
      delivery_ids: [],
      selected_webhook_ids: [],
      errors: 0,
    };
  }

  const owner = await getOrganizationDeliveryState(organizationId, exec);
  if (!owner?.active) {
    return {
      matched_rules: 0,
      queued_deliveries: 0,
      delivery_ids: [],
      selected_webhook_ids: [],
      errors: 0,
    };
  }

  const [rows] = await exec(
    `SELECT *
       FROM snmp_trap_forwarding_rules
      WHERE organization_id = ? AND is_active = 1 AND deleted_at IS NULL
        AND configuration_reviewed_at IS NOT NULL
      ORDER BY id ASC
      LIMIT ${MAX_ACTIVE_RULES + 1}${atomic ? ' FOR UPDATE' : ''}`,
    [organizationId],
  );
  if (rows.length > MAX_ACTIVE_RULES) {
    logger.warn({ organizationId, maxRules: MAX_ACTIVE_RULES }, 'Trap forwarding active-rule limit exceeded; extra rules skipped');
  }

  const payload = buildForwardPayload(trap, device);
  const matching = rows.slice(0, MAX_ACTIVE_RULES).filter(rule => matchesRule(rule, trap));
  const resolved = [];
  let errors = 0;
  for (const [ruleIndex, rule] of matching.entries()) {
    const savepoint = `trap_forward_resolve_${ruleIndex + 1}`;
    if (atomic) await exec(`SAVEPOINT ${savepoint}`);
    try {
      const destination = await resolveDestinationSnapshot(rule, organizationId, exec);
      if (!destination) {
        errors++;
        await updateRuleSummary(
          rule.id,
          organizationId,
          'cancelled',
          'Rule is paused until exactly one valid destination is configured.',
          false,
          exec,
        );
      } else {
        resolved.push({ rule, destination });
      }
      if (atomic) await exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (err) {
      errors++;
      if (atomic) {
        await exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      logger.error({ err, organizationId, ruleId: rule.id, trapId: payload.trap.id }, 'Could not resolve trap forwarding destination');
    }
  }
  const quota = typeof options.reserveCapacity === 'function'
    ? await options.reserveCapacity(resolved.length)
    : { allowed_count: resolved.length, skipped_count: 0, reason: null };
  const eligible = resolved.slice(0, Math.max(0, Number(quota.allowed_count) || 0));
  const deliveryIds = [];
  const selectedWebhookIds = new Set();

  for (const [ruleIndex, entry] of eligible.entries()) {
    const { rule, destination } = entry;
    const savepoint = `trap_forward_rule_${ruleIndex + 1}`;
    if (atomic) await exec(`SAVEPOINT ${savepoint}`);
    try {
      const delivery = await insertDelivery({
        rule,
        organizationId,
        organizationEpoch: owner.epoch,
        trapId: payload.trap.id,
        destination,
        payload,
        exec,
      });
      if (delivery.created) deliveryIds.push(delivery.id);
      if (destination.type === 'webhook') selectedWebhookIds.add(destination.webhookId);
      if (atomic) await exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (err) {
      errors++;
      if (atomic) {
        // A malformed/stale legacy rule or destination FK must not erase the
        // received trap or other valid outbox rows in the outer transaction.
        // The fixed generated savepoint name is not influenced by user input.
        await exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      logger.error({ err, organizationId, ruleId: rule.id, trapId: payload.trap.id }, 'Could not persist trap forwarding delivery');
    }
  }

  const reservedButNotPersisted = Math.max(0, eligible.length - deliveryIds.length);
  if (reservedButNotPersisted && typeof options.refundCapacity === 'function') {
    await options.refundCapacity(reservedButNotPersisted);
  }

  return {
    matched_rules: matching.length,
    queued_deliveries: deliveryIds.length,
    delivery_ids: deliveryIds,
    selected_webhook_ids: [...selectedWebhookIds],
    errors,
    skipped_deliveries: Number(quota.skipped_count || 0),
    skip_reason: quota.reason || null,
  };
}

async function enqueuePreparedDeliveries(deliveryIds, organizationId) {
  // Every row is already durable, so queue all jobs concurrently under the
  // producer's one aggregate deadline. A deterministic jobId makes a late
  // Redis acknowledgement, receiver retry, and scheduled sweep idempotent.
  const settled = await Promise.allSettled(deliveryIds.map(async deliveryId => {
    const result = await enqueueDeliveryJob(deliveryId, organizationId);
    if (result?.status !== 'queued') {
      const err = new Error('Delivery remains durable-pending');
      err.code = 'JOB_QUEUE_DURABLE_PENDING';
      throw err;
    }
    return result;
  }));
  let queued = 0;
  let failed = 0;
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      queued++;
      return;
    }
    failed++;
    logger.warn(
      { err: result.reason, deliveryId: deliveryIds[index], organizationId },
      'Trap forwarding delivery remains pending for retry sweep',
    );
  });
  return { queued, failed, total: deliveryIds.length };
}

async function forwardTrap(trap, device = null, primaryContext = false) {
  if (!primaryContext && typeof db.withPrimaryContext === 'function') {
    return db.withPrimaryContext(() => forwardTrap(trap, device, true));
  }
  const prepared = await prepareTrapDeliveries(trap, device);
  const organizationId = trap?.organizationId ?? trap?.organization_id;
  // Queue only after every row is durable. A queue outage leaves rows pending;
  // processRetries() will recover them on the scheduled sweep.
  await enqueuePreparedDeliveries(prepared.delivery_ids, organizationId);
  return prepared;
}

async function queueTestDelivery(rule, organizationId, options = {}, primaryContext = false) {
  // Backward compatibility for the internal recursive form used before this
  // function accepted a prevalidated destination snapshot.
  if (typeof options === 'boolean') {
    primaryContext = options;
    options = {};
  }
  if (!primaryContext && typeof db.withPrimaryContext === 'function') {
    return db.withPrimaryContext(() => queueTestDelivery(rule, organizationId, options, true));
  }
  if (!config.features.snmp) {
    throw new AppError('SNMP trap forwarding is disabled.', 503, 'feature_disabled');
  }
  if (typeof db.withPrimaryContext === 'function' && typeof db.getConnection === 'function') {
    const readiness = await checkSchemaReadiness({ force: true });
    if (!readiness.ready) {
      throw new AppError(
        'Trap forwarding is unavailable until source attribution is ready.',
        503,
        readiness.reason || 'TRAP_FORWARDING_UNAVAILABLE',
      );
    }
  }
  let prevalidatedDestination = options.prevalidatedDestination || null;
  if (!prevalidatedDestination) {
    const validation = {};
    await validateRuleInput({}, organizationId, rule, {
      forceTargetValidation: true,
      validationResult: validation,
    });
    prevalidatedDestination = validation.destination;
  }
  const prevalidatedConfiguration = options.prevalidatedConfiguration
    || ruleConfigurationFingerprint(rule);
  const persist = async (currentRule, exec = db.query) => {
    if (ruleConfigurationFingerprint(currentRule) !== prevalidatedConfiguration) {
      throw outboundValidationConflict();
    }
    if (!currentRule?.configuration_reviewed_at) {
      throw new AppError('Review this rule before sending a test.', 422, 'TRAP_FORWARDING_REVIEW_REQUIRED');
    }
    const destination = await resolveDestinationSnapshot(currentRule, organizationId, exec);
    if (!destination) {
      throw new AppError('Review this rule and configure exactly one valid destination before testing.', 422, 'INVALID_TRAP_FORWARDING_DESTINATION');
    }
    // DNS resolution happened before the transaction connection was checked
    // out. Bind that result to the locked row/destination; the eventual
    // transport resolves again and pins its own connection.
    assertPrevalidatedDestination(destination, prevalidatedDestination);
    return insertDelivery({
      rule: currentRule,
      organizationId,
      destination,
      payload: buildTestPayload(currentRule, organizationId),
      isTest: true,
      exec,
    });
  };

  let delivery;
  if (typeof db.getConnection === 'function') {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const exec = conn.execute.bind(conn);
      const [rows] = await exec(
        `SELECT * FROM snmp_trap_forwarding_rules
          WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [rule.id, organizationId],
      );
      if (!rows[0]) throw new AppError('Trap forwarding rule not found.', 404, 'NOT_FOUND');
      delivery = await persist(rows[0], exec);
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      try { conn.release(); } catch (_) { /* pool already discarded it */ }
    }
  } else {
    delivery = await persist(rule);
  }
  const deliveryId = delivery.id;
  await enqueueDeliveryJob(deliveryId, organizationId).catch(err => {
    logger.warn({ err, deliveryId, organizationId }, 'Test delivery remains pending for retry sweep');
  });
  return { id: deliveryId, status: 'pending', is_test: true };
}

function snapshotMatchesCurrentRule(row) {
  if (!row?.current_rule_id || !row.configuration_reviewed_at) return false;
  if (!row.current_organization_id
      || row.current_organization_status !== 'active'
      || row.current_organization_deleted_at
      || Number(row.organization_epoch) !== Number(row.current_organization_epoch)) return false;
  if (!row.is_test && !row.rule_is_active) return false;
  if (row.rule_deleted_at) return false;
  const targetType = String(row.target_type || '');
  if (targetType === 'url') {
    return String(row.rule_forward_to_url || '') === String(row.target_url || '')
      && !row.rule_forward_to_email && !row.rule_forward_to_webhook_id;
  }
  if (targetType === 'email') {
    return String(row.rule_forward_to_email || '') === String(row.target_email || '')
      && !row.rule_forward_to_url && !row.rule_forward_to_webhook_id;
  }
  if (targetType === 'webhook') {
    return Number(row.rule_forward_to_webhook_id) === Number(row.webhook_id)
      && !row.rule_forward_to_url && !row.rule_forward_to_email
      && Number(row.current_webhook_id) === Number(row.webhook_id)
      && String(row.current_webhook_url || '') === String(row.target_url || '')
      && Boolean(row.current_webhook_is_active) && !row.current_webhook_deleted_at;
  }
  return false;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parsePayload(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function backoffMs(attemptNumber) {
  const ceiling = Math.min(3600000, 10000 * (2 ** Math.max(0, attemptNumber - 1)));
  return Math.max(1000, Math.floor(Math.random() * ceiling));
}

function mysqlDateAfter(delayMs) {
  return new Date(Date.now() + delayMs).toISOString().slice(0, 19).replace('T', ' ');
}

function isRetryableHttp(statusCode) {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

async function setDeliveryOutcome(row, status, {
  error = null,
  httpStatus = null,
  responseTimeMs = null,
  nextAttemptAt = null,
} = {}) {
  const [result] = await db.query(
    `UPDATE snmp_trap_forwarding_deliveries
        SET status = ?, http_status_code = ?, response_time_ms = ?,
            last_error = ?, next_attempt_at = ?, locked_at = NULL,
            claim_token = NULL,
            delivered_at = CASE WHEN ? = 'success' THEN NOW() ELSE delivered_at END
      WHERE id = ? AND organization_id = ?
        AND status = 'processing' AND claim_token = ?`,
    [
      status,
      httpStatus,
      responseTimeMs,
      truncate(error, 1000),
      nextAttemptAt,
      status,
      row.id,
      row.organization_id,
      row.claim_token,
    ],
  );
  // A stale worker must never overwrite the outcome from a newer claimant.
  if (!result?.affectedRows) {
    return { id: row.id, status: 'superseded', attempt_number: Number(row.attempt_number) };
  }
  await updateRuleSummary(row.rule_id, row.organization_id, status, error, Boolean(row.is_test));
  return {
    id: row.id,
    status,
    attempt_number: Number(row.attempt_number),
    next_attempt_at: nextAttemptAt,
  };
}

async function authoritativeOrganizationDeliveryState(organizationId) {
  // Production always exposes withPrimaryContext. Query-only adapters used by
  // isolated unit consumers predate tenant routing and have no authoritative
  // host database to consult.
  if (typeof db.withPrimaryContext !== 'function') return { active: true, epoch: null };
  return db.withPrimaryContext(() => getOrganizationDeliveryState(organizationId));
}

/**
 * Revoke work that has not yet been claimed. A processing attempt owns its
 * immutable snapshot and may finish once; pausing/deleting/changing a rule is
 * therefore not a recall mechanism for an HTTP request already in flight.
 */
async function cancelUnclaimedDeliveriesForRule(
  ruleId,
  organizationId,
  reason = 'Forwarding rule configuration changed.',
  exec = db.query,
) {
  const [result] = await exec(
    `UPDATE snmp_trap_forwarding_deliveries
        SET status = 'cancelled', next_attempt_at = NULL,
            locked_at = NULL, claim_token = NULL, last_error = ?
      WHERE rule_id = ? AND organization_id = ?
        AND status IN ('pending','retrying')`,
    [truncate(reason, 500), ruleId, organizationId],
  );
  return Number(result?.affectedRows || 0);
}

async function cancelUnavailableDeliveries(organizationId, reason) {
  const scoped = Number.isSafeInteger(Number(organizationId)) && Number(organizationId) > 0;
  const orgClause = scoped ? ' AND organization_id = ?' : '';
  const params = scoped ? [truncate(reason, 500), Number(organizationId)] : [truncate(reason, 500)];
  const [cancelled] = await db.query(
    `UPDATE snmp_trap_forwarding_deliveries
        SET status = 'cancelled', locked_at = NULL, claim_token = NULL,
            next_attempt_at = NULL, last_error = ?
      WHERE (status IN ('pending','retrying')
          OR (status = 'processing'
            AND locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE)))${orgClause}`,
    params,
  );
  const ruleOrgClause = scoped ? ' AND r.organization_id = ?' : '';
  await db.query(
    `UPDATE snmp_trap_forwarding_rules r
        SET r.last_delivery_status = 'cancelled', r.last_delivery_at = NOW(),
            r.last_error = ?, r.last_delivery_is_test = FALSE
      WHERE r.deleted_at IS NULL${ruleOrgClause}
        AND EXISTS (
          SELECT 1 FROM snmp_trap_forwarding_deliveries d
           WHERE d.rule_id = r.id AND d.organization_id = r.organization_id
             AND d.status = 'cancelled' AND d.last_error = ?
        )`,
    scoped
      ? [truncate(reason, 500), Number(organizationId), truncate(reason, 500)]
      : [truncate(reason, 500), truncate(reason, 500)],
  );
  return Number(cancelled?.affectedRows || 0);
}

async function updateRuleSummaryForDelivery(deliveryId, organizationId, status, reason) {
  await db.query(
    `UPDATE snmp_trap_forwarding_rules r
       JOIN snmp_trap_forwarding_deliveries d
         ON d.rule_id = r.id AND d.organization_id = r.organization_id
        SET r.last_delivery_status = ?, r.last_delivery_at = NOW(),
            r.last_error = ?, r.last_delivery_is_test = d.is_test
      WHERE d.id = ? AND d.organization_id = ?`,
    [status, truncate(reason, 500), deliveryId, organizationId],
  ).catch(err => logger.warn(
    { err, deliveryId, organizationId },
    'Could not update trap forwarding rule summary after cancellation',
  ));
}

/** Process one previously persisted delivery. Safe for duplicate job claims. */
async function attemptDelivery(deliveryId, expectedOrganizationId = null, primaryContext = false) {
  if (!primaryContext && typeof db.withPrimaryContext === 'function') {
    return db.withPrimaryContext(
      () => attemptDelivery(deliveryId, expectedOrganizationId, true),
    );
  }
  if (!config.features.snmp) {
    const orgClause = expectedOrganizationId === null || expectedOrganizationId === undefined
      ? ''
      : ' AND organization_id = ?';
    const [cancelled] = await db.query(
      `UPDATE snmp_trap_forwarding_deliveries
          SET status = 'cancelled', locked_at = NULL, claim_token = NULL,
              next_attempt_at = NULL, last_error = 'SNMP trap forwarding is disabled.'
        WHERE id = ?${orgClause}
          AND (status IN ('pending','retrying')
            OR (status = 'processing'
              AND locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE)))`,
      expectedOrganizationId === null || expectedOrganizationId === undefined
        ? [deliveryId]
        : [deliveryId, expectedOrganizationId],
    );
    if (cancelled?.affectedRows && expectedOrganizationId !== null
        && expectedOrganizationId !== undefined) {
      await updateRuleSummaryForDelivery(
        deliveryId,
        expectedOrganizationId,
        'cancelled',
        'SNMP trap forwarding is disabled.',
      );
    }
    return { id: deliveryId, status: 'cancelled', reason: 'feature_disabled' };
  }
  if (typeof db.withPrimaryContext === 'function' && typeof db.getConnection === 'function') {
    const readiness = await checkSchemaReadiness({ force: true });
    if (!readiness.ready) {
      if (!isStableAttributionPolicyFailure(readiness.reason)) {
        // A transient schema/config lookup failure is not a revocation. Leave
        // the durable row untouched so the scheduled sweep can recover after
        // the database becomes healthy, and perform no external I/O now.
        return {
          id: deliveryId,
          status: 'deferred',
          reason: readiness.reason || 'trap_forwarding_unavailable',
        };
      }
      const orgClause = expectedOrganizationId === null || expectedOrganizationId === undefined
        ? ''
        : ' AND organization_id = ?';
      const [cancelled] = await db.query(
        `UPDATE snmp_trap_forwarding_deliveries
            SET status = 'cancelled', locked_at = NULL, claim_token = NULL,
                next_attempt_at = NULL,
                last_error = 'Trap forwarding unavailable: source attribution is not supported.'
          WHERE id = ?${orgClause}
            AND (status IN ('pending','retrying')
              OR (status = 'processing'
                AND locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE)))`,
        expectedOrganizationId === null || expectedOrganizationId === undefined
          ? [deliveryId]
          : [deliveryId, expectedOrganizationId],
      );
      if (cancelled?.affectedRows && expectedOrganizationId !== null
          && expectedOrganizationId !== undefined) {
        await updateRuleSummaryForDelivery(
          deliveryId,
          expectedOrganizationId,
          'cancelled',
          'Trap forwarding unavailable: source attribution is not supported.',
        );
      }
      return {
        id: deliveryId,
        status: 'cancelled',
        reason: readiness.reason || 'trap_forwarding_unavailable',
      };
    }
  }
  const orgPredicate = expectedOrganizationId === null || expectedOrganizationId === undefined
    ? ''
    : ' AND d.organization_id = ?';
  const [preflightRows] = await db.query(
    `SELECT d.id, d.organization_id, d.organization_epoch,
            d.rule_id, d.webhook_id, d.target_type,
            d.target_url, d.target_email, d.is_test, d.status, d.locked_at,
            r.id AS current_rule_id, r.is_active AS rule_is_active,
            r.deleted_at AS rule_deleted_at, r.configuration_reviewed_at,
            r.forward_to_url AS rule_forward_to_url,
            r.forward_to_email AS rule_forward_to_email,
            r.forward_to_webhook_id AS rule_forward_to_webhook_id,
            w.id AS current_webhook_id, w.url AS current_webhook_url,
            w.is_active AS current_webhook_is_active,
            w.deleted_at AS current_webhook_deleted_at,
            o.id AS current_organization_id,
            o.status AS current_organization_status,
            o.deleted_at AS current_organization_deleted_at,
            o.outbound_delivery_epoch AS current_organization_epoch
       FROM snmp_trap_forwarding_deliveries d
       LEFT JOIN snmp_trap_forwarding_rules r
         ON r.id = d.rule_id AND r.organization_id = d.organization_id
       LEFT JOIN webhooks w
         ON w.id = d.webhook_id AND w.organization_id = d.organization_id
       LEFT JOIN organizations o ON o.id = d.organization_id
      WHERE d.id = ?${orgPredicate}
      LIMIT 1`,
    expectedOrganizationId === null || expectedOrganizationId === undefined
      ? [deliveryId]
      : [deliveryId, expectedOrganizationId],
  );
  const preflight = preflightRows[0];
  if (!preflight) return { id: deliveryId, status: 'not_due' };
  if (!snapshotMatchesCurrentRule(preflight)) {
    const [cancelled] = await db.query(
      `UPDATE snmp_trap_forwarding_deliveries
          SET status = 'cancelled', locked_at = NULL, claim_token = NULL,
              next_attempt_at = NULL,
              last_error = 'Forwarding destination or rule configuration changed.'
        WHERE id = ? AND organization_id = ?
          AND (status IN ('pending','retrying')
            OR (status = 'processing'
              AND locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE)))`,
      [deliveryId, preflight.organization_id],
    );
    if (cancelled?.affectedRows) {
      await updateRuleSummary(
        preflight.rule_id,
        preflight.organization_id,
        'cancelled',
        'Forwarding destination or rule configuration changed.',
        Boolean(preflight.is_test),
      );
      return { id: deliveryId, status: 'cancelled', reason: 'destination_changed' };
    }
    return { id: deliveryId, status: 'not_due' };
  }
  const claimOrgPredicate = expectedOrganizationId === null || expectedOrganizationId === undefined
    ? ''
    : ' AND organization_id = ?';
  const claimToken = crypto.randomUUID();
  const claimParams = expectedOrganizationId === null || expectedOrganizationId === undefined
    ? [claimToken, deliveryId]
    : [claimToken, deliveryId, expectedOrganizationId];
  const [claim] = await db.query(
    `UPDATE snmp_trap_forwarding_deliveries
        SET claim_token = CONCAT(
              CASE
                WHEN status = 'processing' AND attempt_number >= max_attempts
                  AND recovery_count >= ${MAX_AMBIGUOUS_RECOVERIES} THEN 'X'
                WHEN status = 'processing' AND attempt_number >= max_attempts THEN 'R'
                WHEN status = 'processing' THEN 'S'
                ELSE 'F'
              END,
              SUBSTRING(?, 2)
            ),
            recovery_count = recovery_count
              + CASE WHEN LEFT(claim_token, 1) = 'R' THEN 1 ELSE 0 END,
            attempt_number = attempt_number
              + CASE WHEN LEFT(claim_token, 1) IN ('F','S') THEN 1 ELSE 0 END,
            status = CASE WHEN LEFT(claim_token, 1) = 'X'
              THEN 'dead_letter' ELSE 'processing' END,
            locked_at = CASE WHEN LEFT(claim_token, 1) = 'X' THEN NULL ELSE NOW() END,
            next_attempt_at = NULL,
            last_error = CASE WHEN LEFT(claim_token, 1) = 'X'
              THEN 'Previous delivery worker exhausted its bounded crash recovery.'
              ELSE last_error END
      WHERE id = ?${claimOrgPredicate}
        AND revoked_at IS NULL
        AND (
          (status IN ('pending','retrying') AND attempt_number < max_attempts
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          OR (status = 'processing' AND locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE))
        )`,
    claimParams,
  );
  if (!claim?.affectedRows) return { id: deliveryId, status: 'not_due' };

  const [rows] = await db.query(
    `SELECT d.*, r.id AS current_rule_id, r.name AS rule_name,
            r.is_active AS rule_is_active,
            r.deleted_at AS rule_deleted_at,
            r.configuration_reviewed_at,
            r.forward_to_url AS rule_forward_to_url,
            r.forward_to_email AS rule_forward_to_email,
            r.forward_to_webhook_id AS rule_forward_to_webhook_id,
            w.id AS current_webhook_id, w.url AS current_webhook_url,
            w.is_active AS current_webhook_is_active,
            w.deleted_at AS current_webhook_deleted_at,
            o.id AS current_organization_id,
            o.status AS current_organization_status,
            o.deleted_at AS current_organization_deleted_at,
            o.outbound_delivery_epoch AS current_organization_epoch
       FROM snmp_trap_forwarding_deliveries d
       LEFT JOIN snmp_trap_forwarding_rules r
         ON r.id = d.rule_id AND r.organization_id = d.organization_id
       LEFT JOIN webhooks w
         ON w.id = d.webhook_id AND w.organization_id = d.organization_id
       LEFT JOIN organizations o ON o.id = d.organization_id
      WHERE d.id = ? AND RIGHT(d.claim_token, 35) = RIGHT(?, 35)${claimOrgPredicate.replace('organization_id', 'd.organization_id')}
      LIMIT 1`,
    expectedOrganizationId === null || expectedOrganizationId === undefined
      ? [deliveryId, claimToken]
      : [deliveryId, claimToken, expectedOrganizationId],
  );
  const row = rows[0];
  if (!row) return { id: deliveryId, status: 'superseded' };
  const returnedClaimToken = String(row.claim_token || claimToken);
  row.claim_token = returnedClaimToken;

  if (returnedClaimToken.startsWith('X') || row.status === 'dead_letter') {
    const error = 'Previous delivery worker exhausted its bounded crash recovery.';
    await updateRuleSummary(row.rule_id, row.organization_id, 'dead_letter', error, Boolean(row.is_test));
    return { id: row.id, status: 'dead_letter', attempt_number: Number(row.attempt_number) };
  }

  // A rule/webhook can change after the unclaimed preflight but before a stale
  // worker is reclaimed. Mutation triggers intentionally leave processing rows
  // alone (an already in-flight request may finish once), so the new claimant
  // must recheck the immutable snapshot while it owns the CAS token.
  if (!snapshotMatchesCurrentRule(row)) {
    return setDeliveryOutcome(row, 'cancelled', {
      error: 'Forwarding destination, rule, or organization changed before delivery began.',
    });
  }

  let organizationState;
  try {
    organizationState = await authoritativeOrganizationDeliveryState(row.organization_id);
  } catch (_err) {
    const exhausted = Number(row.attempt_number) >= Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS);
    return setDeliveryOutcome(row, exhausted ? 'dead_letter' : 'retrying', {
      error: 'Organization status could not be verified.',
      nextAttemptAt: exhausted ? null : mysqlDateAfter(backoffMs(Number(row.attempt_number))),
    });
  }
  if (!organizationState?.active
      || (organizationState.epoch !== null
        && Number(row.organization_epoch) !== Number(organizationState.epoch))) {
    return setDeliveryOutcome(row, 'cancelled', {
      error: organizationState?.active
        ? 'Organization lifecycle changed after this delivery was queued.'
        : 'Organization is suspended or deleted.',
    });
  }

  // The successful claim is the revocation boundary. API mutations cancel
  // pending/retrying rows atomically, while an already-processing attempt may
  // complete once using this row's immutable target/payload snapshot.

  const payload = parsePayload(row.payload);
  if (row.is_test && typeof db.withPrimaryContext === 'function' && typeof db.getConnection === 'function') {
    const {
      activeIsolatedOrganizations,
      retainedOrganizations,
    } = require('./tenantDeviceResolverService');
    const preflightConnection = await db.getConnection();
    try {
      await preflightConnection.beginTransaction();
      const exec = preflightConnection.execute.bind(preflightConnection);
      const isolated = await activeIsolatedOrganizations(
        exec,
        { lock: true },
      );
      const organizations = isolated.length
        ? []
        : await retainedOrganizations(exec, { lock: true });
      if (isolated.length
          || organizations.length !== 1
          || Number(organizations[0]) !== Number(row.organization_id)) {
        await preflightConnection.rollback();
        try { preflightConnection.release(); } catch (_) { /* pool discarded */ }
        return setDeliveryOutcome(row, 'cancelled', {
          error: 'Trap forwarding became unavailable before the test was sent.',
        });
      }
      await preflightConnection.commit();
      try { preflightConnection.release(); } catch (_) { /* pool discarded */ }
    } catch (_err) {
      await preflightConnection.rollback().catch(() => {});
      try { preflightConnection.release(); } catch (_) { /* pool discarded */ }
      return setDeliveryOutcome(row, 'retrying', {
        error: 'Trap forwarding readiness could not be verified.',
        nextAttemptAt: mysqlDateAfter(backoffMs(Number(row.attempt_number))),
      });
    }
  }
  if (!row.is_test && typeof db.withPrimaryContext === 'function' && typeof db.getConnection === 'function') {
    const deviceId = Number(payload?.device?.id);
    const sourceIp = normalizeIp(payload?.trap?.source_ip);
    if (!Number.isSafeInteger(deviceId) || !sourceIp) {
      return setDeliveryOutcome(row, 'cancelled', {
        error: 'The trap source is no longer bound to the queued device.',
      });
    }
    const { lockSharedDeviceByIp } = require('./tenantDeviceResolverService');
    const preflightConnection = await db.getConnection();
    try {
      await preflightConnection.beginTransaction();
      const locked = await lockSharedDeviceByIp(
        sourceIp,
        preflightConnection.execute.bind(preflightConnection),
      );
      if (!locked.device
          || Number(locked.device.id) !== deviceId
          || Number(locked.device.organization_id) !== Number(row.organization_id)) {
        await preflightConnection.rollback();
        try { preflightConnection.release(); } catch (_) { /* pool discarded */ }
        return setDeliveryOutcome(row, 'cancelled', {
          error: 'The trap source is ambiguous, unavailable, or no longer bound to the queued device.',
        });
      }
      // The lock protects the authoritative check itself. Release it before
      // network I/O; once claimed, conventional in-flight semantics apply.
      await preflightConnection.commit();
      try { preflightConnection.release(); } catch (_) { /* pool discarded */ }
    } catch (_err) {
      await preflightConnection.rollback().catch(() => {});
      try { preflightConnection.release(); } catch (_) { /* pool discarded */ }
      return setDeliveryOutcome(row, 'retrying', {
        error: 'Trap source ownership could not be verified.',
        nextAttemptAt: mysqlDateAfter(backoffMs(Number(row.attempt_number))),
      });
    }
  }
  let httpStatus = null;
  let responseTimeMs = null;
  let failure = null;
  let retryable = true;

  try {
    if (row.target_type === 'email') {
      const plain = JSON.stringify(payload, null, 2);
      const trapType = truncate(payload?.trap?.type || 'test', 64) || 'test';
      const result = await emailTransport.sendEmail({
        organizationId: row.organization_id,
        emailFunction: 'noc',
        to: row.target_email,
        subject: `FireISP SNMP trap: ${trapType}`,
        text: plain,
        html: `<p>FireISP received an SNMP trap matching rule <strong>${escapeHtml(row.rule_name || '')}</strong>.</p><pre>${escapeHtml(plain)}</pre>`,
        absoluteTimeoutMs: EMAIL_DELIVERY_TIMEOUT_MS,
        // Trap forwarding is tenant-configurable. Never let a rule/test use
        // the tenant's arbitrary SMTP host as a network target; only the
        // install operator's trusted global relay may carry trap email.
        installTransportOnly: true,
        sanitizeFailure: true,
      });
      if (!result?.success) {
        throw Object.assign(
          new Error(result?.error || 'Email delivery failed'),
          result?.code ? { code: result.code } : {},
        );
      }
    } else if (row.target_type === 'url' || row.target_type === 'webhook') {
      let secret = null;
      let timeoutMs = REQUEST_TIMEOUT_MS;
      if (row.target_type === 'webhook') {
        const webhook = await getActiveWebhook(row.organization_id, Number(row.webhook_id));
        if (!webhook) {
          return setDeliveryOutcome(row, 'cancelled', { error: 'Registered webhook is no longer active for this organization.' });
        }
        if (String(webhook.url || '') !== String(row.target_url || '')) {
          return setDeliveryOutcome(row, 'cancelled', { error: 'Registered webhook destination changed after this delivery was queued.' });
        }
        secret = webhook.secret_encrypted ? decrypt(webhook.secret_encrypted) : null;
        timeoutMs = Math.min(60000, Math.max(1000, Number(webhook.timeout_seconds || 10) * 1000));
      }

      const event = payload.event || 'snmp.trap';
      const body = JSON.stringify({
        event,
        delivery_id: row.id,
        data: payload,
        timestamp: new Date(row.created_at).toISOString(),
      });
      const signature = secret
        ? crypto.createHmac('sha256', secret).update(body).digest('hex')
        : null;
      const response = await safeHttpsPost(row.target_url, body, {
        'Content-Type': 'application/json',
        'User-Agent': 'FireISP-Trap-Forwarder/5.0',
        'X-FireISP-Event': event,
        'X-FireISP-Delivery-Id': String(row.id),
        ...(signature && { 'X-FireISP-Signature': `sha256=${signature}` }),
      }, timeoutMs);
      httpStatus = response.statusCode;
      responseTimeMs = response.responseTimeMs;
      if (httpStatus < 200 || httpStatus >= 300) {
        failure = `Destination returned HTTP ${httpStatus}.`;
        retryable = isRetryableHttp(httpStatus);
      }
    } else {
      failure = 'Delivery has an unsupported destination type.';
      retryable = false;
    }
  } catch (err) {
    const safeCode = /^[A-Z0-9_]{2,40}$/.test(String(err?.code || '')) ? ` (${err.code})` : '';
    if (err?.code === 'UNSAFE_URL') {
      failure = 'Destination is no longer a safe public HTTPS URL.';
    } else if (row.target_type === 'email') {
      failure = `Email delivery failed${safeCode}.`;
    } else {
      // Do not copy transport exception text into the operator-visible row: it
      // may echo a credential-bearing webhook path or SMTP recipient.
      failure = `HTTPS delivery failed${safeCode}.`;
    }
    retryable = err?.code !== 'UNSAFE_URL' && err?.code !== 'EMAIL_DELIVERY_TIMEOUT';
  } finally {
    // All source/readiness transactions finish before this outbound block.
  }

  if (!failure) {
    return setDeliveryOutcome(row, 'success', { httpStatus, responseTimeMs });
  }

  const exhausted = Number(row.attempt_number) >= Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS);
  if (!retryable || exhausted) {
    return setDeliveryOutcome(row, 'dead_letter', { error: failure, httpStatus, responseTimeMs });
  }
  const nextAttemptAt = mysqlDateAfter(backoffMs(Number(row.attempt_number)));
  return setDeliveryOutcome(row, 'retrying', {
    error: failure,
    httpStatus,
    responseTimeMs,
    nextAttemptAt,
  });
}

/** Requeue due/retrying rows and reclaim workers that died while processing. */
async function processCurrentDatabaseRetries({
  excludeOrganizationIds = [],
  includeOrganizationId = null,
} = {}) {
  const excluded = [...new Set(excludeOrganizationIds
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  const inclusion = Number.isSafeInteger(Number(includeOrganizationId))
    && Number(includeOrganizationId) > 0
    ? ' AND d.organization_id = ?'
    : '';
  const exclusion = !inclusion && excluded.length
    ? ` AND d.organization_id NOT IN (${excluded.map(() => '?').join(', ')})`
    : '';
  const params = inclusion ? [Number(includeOrganizationId)] : excluded;
  // A configuration change may happen while a worker owns the request. The
  // active owner may still record its outcome, but if it crashes the durable
  // revocation marker prevents an A-to-B-to-A edit from reviving that claim.
  await db.query(
    `UPDATE snmp_trap_forwarding_deliveries d
        SET d.status = 'cancelled', d.next_attempt_at = NULL,
            d.locked_at = NULL, d.claim_token = NULL,
            d.last_error = 'Forwarding configuration changed while delivery was in flight.'
      WHERE d.revoked_at IS NOT NULL
        AND (d.status IN ('pending','retrying')
          OR (d.status = 'processing'
            AND d.locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE)))${inclusion}${exclusion}`,
    params,
  );
  await db.query(
    `UPDATE snmp_trap_forwarding_deliveries d
       LEFT JOIN organizations o ON o.id = d.organization_id
        SET d.status = 'cancelled', d.next_attempt_at = NULL,
            d.locked_at = NULL, d.claim_token = NULL,
            d.last_error = 'Organization lifecycle changed after this delivery was queued.'
      WHERE (o.id IS NULL OR o.status <> 'active' OR o.deleted_at IS NOT NULL
          OR d.organization_epoch <> o.outbound_delivery_epoch)
        AND (d.status IN ('pending','retrying')
          OR (d.status = 'processing'
            AND d.locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE)))${inclusion}${exclusion}`,
    params,
  );
  const [rows] = await db.query(
    `SELECT d.id, d.organization_id
       FROM snmp_trap_forwarding_deliveries d
       JOIN organizations o ON o.id = d.organization_id
        AND o.status = 'active' AND o.deleted_at IS NULL
        AND d.organization_epoch = o.outbound_delivery_epoch
      WHERE (
        (d.status IN ('pending','retrying') AND d.revoked_at IS NULL
          AND d.attempt_number < d.max_attempts
          AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW()))
        OR (d.status = 'processing' AND d.revoked_at IS NULL
          AND d.locked_at < DATE_SUB(NOW(), INTERVAL ${PROCESSING_STALE_MINUTES} MINUTE))
      )${inclusion}${exclusion}
      ORDER BY COALESCE(d.next_attempt_at, d.locked_at, d.created_at) ASC
      LIMIT ${MAX_RETRY_BATCH}`,
    params,
  );
  let queued = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await enqueueDeliveryJob(row.id, row.organization_id);
      queued++;
    } catch (err) {
      failed++;
      logger.warn({ err, deliveryId: row.id }, 'Could not requeue trap forwarding delivery');
    }
  }
  return { queued, failed, total: rows.length };
}

/** Sweep shared and isolated tenant databases for durable due rows. */
async function processRetries(organizationId = null, primaryContext = false) {
  if (!primaryContext && typeof db.withPrimaryContext === 'function') {
    return db.withPrimaryContext(() => processRetries(organizationId, true));
  }
  if (!config.features.snmp) {
    const reason = 'SNMP trap forwarding is disabled.';
    const cancelled = await cancelUnavailableDeliveries(organizationId, reason);
    return {
      queued: 0,
      failed: 0,
      total: 0,
      cancelled,
      skipped_reason: 'feature_disabled',
    };
  }
  if (typeof db.withPrimaryContext === 'function' && typeof db.getConnection === 'function') {
    const readiness = await checkSchemaReadiness({ force: true });
    if (!readiness.ready) {
      if (isStableAttributionPolicyFailure(readiness.reason)) {
        const reason = 'Trap forwarding unavailable: install-wide source attribution is unsupported.';
        const cancelled = await cancelUnavailableDeliveries(organizationId, reason);
        return {
          queued: 0,
          failed: 0,
          total: 0,
          cancelled,
          skipped_reason: readiness.reason,
        };
      }
      return {
        queued: 0,
        failed: 0,
        total: 0,
        skipped_reason: readiness.reason || 'trap_forwarding_unavailable',
      };
    }
  }
  return processCurrentDatabaseRetries({ includeOrganizationId: organizationId });
}

module.exports = {
  MAX_ACTIVE_RULES,
  MAX_AMBIGUOUS_RECOVERIES,
  matchesRule,
  buildForwardPayload,
  validateRuleInput,
  destinationsForRule,
  ruleConfigurationFingerprint,
  prepareTrapDeliveries,
  enqueuePreparedDeliveries,
  forwardTrap,
  queueTestDelivery,
  attemptDelivery,
  processRetries,
  cancelUnclaimedDeliveriesForRule,
  safeHttpsPost,
  normalizeOid,
  normalizeIp,
};
