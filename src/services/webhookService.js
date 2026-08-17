// =============================================================================
// FireISP 5.0 — Webhook Delivery Service
// =============================================================================
// Delivers outbound webhooks with HMAC-SHA256 signing.
// Failed deliveries are scheduled for background retry with exponential backoff
// rather than retrying inline — call processRetries() from the webhook_retry
// scheduled task to process due retries.
//
// When REDIS_URL is set, dispatch() enqueues jobs via BullMQ and the
// webhook-delivery worker handles delivery + retry natively (no DB polling
// needed).  When REDIS_URL is absent the existing inline + DB-poll path is used.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'webhookService' });
const { decrypt } = require('../utils/encryption');
const { assertSafeOutboundUrl } = require('../utils/safeOutboundUrl');
const {
  safeHttpsPost,
  WEBHOOK_ABSOLUTE_TIMEOUT_MS,
  MAX_WEBHOOK_HEADER_BYTES,
  MAX_WEBHOOK_RESPONSE_BYTES,
} = require('../utils/safeHttpsPost');

const MAX_ACTIVE_WEBHOOKS_PER_ORG = 50;
const WEBHOOK_PROCESSING_STALE_MINUTES = 5;
const RESERVED_TRAP_EVENTS = new Set(['device.trap', 'snmp.trap']);

function isReservedTrapEvent(event) {
  return RESERVED_TRAP_EVENTS.has(String(event || '').trim());
}

async function getOwningOrganizationState(organizationId) {
  const run = async () => {
    const [rows] = await db.query(
      `SELECT id, outbound_delivery_epoch FROM organizations
        WHERE id = ? AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
      [organizationId],
    );
    const row = rows[0];
    return {
      active: Number(row?.id) === Number(organizationId),
      epoch: Number(row?.outbound_delivery_epoch || 0),
    };
  };
  return typeof db.withPrimaryContext === 'function'
    ? db.withPrimaryContext(run)
    : run();
}

async function isOwningOrganizationActive(organizationId) {
  return (await getOwningOrganizationState(organizationId)).active;
}

async function terminalizeInactiveOrganizationDelivery(deliveryId, organizationId) {
  await db.query(
    `UPDATE webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
        SET wd.status = 'dead_letter', wd.next_retry_at = NULL,
            wd.locked_at = NULL, wd.claim_token = NULL,
            wd.response_body = NULL
      WHERE wd.id = ? AND w.organization_id = ?
        AND (wd.status IN ('pending','retrying')
          OR (wd.status = 'processing'
            AND wd.locked_at < DATE_SUB(NOW(), INTERVAL ${WEBHOOK_PROCESSING_STALE_MINUTES} MINUTE)))`,
    [deliveryId, organizationId],
  ).catch(() => {});
}

async function terminalizeReservedTrapDelivery(deliveryRowId, webhookId) {
  if (deliveryRowId) {
    await db.query(
      `UPDATE webhook_deliveries
          SET status = 'dead_letter', next_retry_at = NULL,
              response_body = NULL
        WHERE id = ? AND webhook_id = ?
          AND status IN ('pending','retrying','failed','dead_letter')`,
      [deliveryRowId, webhookId],
    ).catch(() => {});
  }
  return {
    webhook_id: webhookId,
    status: 'dead_letter',
    reason: 'reserved_trap_event',
  };
}

async function claimDurableWebhookDelivery(deliveryId, organizationId) {
  const ownerBeforeClaim = await getOwningOrganizationState(organizationId);
  if (!ownerBeforeClaim.active) {
    await terminalizeInactiveOrganizationDelivery(deliveryId, organizationId);
    return {
      delivery_id: deliveryId,
      organization_inactive: true,
    };
  }
  const claimToken = crypto.randomUUID();
  const [claim] = await db.query(
    `UPDATE webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
        SET wd.claim_token = ?, wd.locked_at = NOW(),
            wd.recovery_count = wd.recovery_count
              + CASE WHEN wd.status = 'processing'
                  AND wd.attempt_number >= (COALESCE(w.max_retries, 5) + 1)
                THEN 1 ELSE 0 END,
            wd.status = 'processing',
            wd.attempt_number = wd.attempt_number
              + CASE WHEN wd.attempt_number < (COALESCE(w.max_retries, 5) + 1)
                THEN 1 ELSE 0 END,
            wd.next_retry_at = NULL
      WHERE wd.id = ? AND w.organization_id = ?
        AND w.is_active = 1 AND w.deleted_at IS NULL
        AND wd.organization_epoch = ?
        AND BINARY wd.target_url = BINARY w.url
        AND wd.revoked_at IS NULL
        AND (wd.status = 'pending'
          OR (wd.status = 'retrying'
            AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= NOW()))
          OR (wd.status = 'processing'
            AND wd.locked_at < DATE_SUB(NOW(), INTERVAL ${WEBHOOK_PROCESSING_STALE_MINUTES} MINUTE)
            AND (wd.attempt_number < (COALESCE(w.max_retries, 5) + 1)
              OR wd.recovery_count < 1)))`,
    [claimToken, deliveryId, organizationId, ownerBeforeClaim.epoch],
  );
  if (!claim?.affectedRows) {
    await db.query(
      `UPDATE webhook_deliveries wd
         JOIN webhooks w ON w.id = wd.webhook_id
          SET wd.status = 'dead_letter', wd.next_retry_at = NULL,
              wd.locked_at = NULL, wd.claim_token = NULL,
              wd.response_body = NULL
        WHERE wd.id = ? AND w.organization_id = ?
          AND wd.organization_epoch <> ?
          AND (wd.status IN ('pending','retrying')
            OR (wd.status = 'processing'
              AND wd.locked_at < DATE_SUB(NOW(), INTERVAL ${WEBHOOK_PROCESSING_STALE_MINUTES} MINUTE)))`,
      [deliveryId, organizationId, ownerBeforeClaim.epoch],
    ).catch(() => {});
    return null;
  }
  const [rows] = await db.query(
    `SELECT w.*, wd.id AS delivery_id, wd.event_name AS delivery_event,
            wd.payload AS delivery_payload, wd.attempt_number,
            wd.claim_token, wd.target_url AS delivery_target_url,
            wd.organization_epoch AS delivery_organization_epoch,
            wd.created_at AS delivery_created_at
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
      WHERE wd.id = ? AND w.organization_id = ?
        AND wd.status = 'processing' AND wd.claim_token = ?
      LIMIT 1`,
    [deliveryId, organizationId, claimToken],
  );
  const row = rows[0] || null;
  if (!row || Number(row.organization_id) !== Number(organizationId)) return null;
  // Suspension may commit after the pre-claim check. The claim is the
  // documented in-flight boundary, so perform one final authoritative primary
  // check while this worker owns the row and revoke that exact claim before
  // any external I/O if the owner is no longer active.
  const ownerAfterClaim = await getOwningOrganizationState(organizationId);
  if (!ownerAfterClaim.active
      || Number(row.delivery_organization_epoch) !== Number(ownerAfterClaim.epoch)) {
    await setDurableWebhookOutcome(row, 'dead_letter');
    return {
      delivery_id: deliveryId,
      organization_inactive: true,
    };
  }
  return row;
}

async function setDurableWebhookOutcome(row, status, {
  httpStatus = null,
  responseTimeMs = null,
  nextRetry = null,
} = {}) {
  const [updated] = await db.query(
    `UPDATE webhook_deliveries
        SET http_status_code = ?, response_body = NULL, response_time_ms = ?,
            status = ?, next_retry_at = ?,
            delivered_at = CASE WHEN ? = 'success' THEN NOW() ELSE delivered_at END,
            locked_at = NULL, claim_token = NULL
      WHERE id = ? AND webhook_id = ?
        AND status = 'processing' AND claim_token = ?`,
    [httpStatus, responseTimeMs, status, nextRetry, status,
      row.delivery_id, row.id, row.claim_token],
  );
  if (!updated?.affectedRows) return { status: 'superseded', webhook_id: row.id };
  return {
    status,
    webhook_id: row.id,
    delivery_id: row.delivery_id,
    attempt_number: Number(row.attempt_number),
    next_retry_at: nextRetry,
  };
}

async function deliverDurableWebhook(deliveryId, organizationId) {
  if (!config.features.webhooks) {
    return { status: 'webhook_disabled', delivery_id: deliveryId };
  }
  const webhook = await claimDurableWebhookDelivery(deliveryId, organizationId);
  if (!webhook) return { status: 'not_due', delivery_id: deliveryId };
  if (webhook.organization_inactive) {
    return { status: 'dead_letter', delivery_id: deliveryId, reason: 'organization_inactive' };
  }
  if (isReservedTrapEvent(webhook.delivery_event)) {
    return setDurableWebhookOutcome(webhook, 'dead_letter');
  }

  const body = typeof webhook.delivery_payload === 'string'
    ? webhook.delivery_payload
    : JSON.stringify(webhook.delivery_payload || {});
  const secret = signingSecret(webhook);
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(body).digest('hex')
    : null;
  const timeout = (webhook.timeout_seconds || 10) * 1000;
  const startedAt = Date.now();
  let httpStatus = null;
  let responseTimeMs;
  let terminalFailure;
  try {
    const response = await httpPost(webhook.delivery_target_url, body, {
      'Content-Type': 'application/json',
      'X-FireISP-Event': webhook.delivery_event,
      ...(signature && { 'X-FireISP-Signature': `sha256=${signature}` }),
    }, timeout);
    responseTimeMs = Date.now() - startedAt;
    httpStatus = response.statusCode;
    if (httpStatus >= 200 && httpStatus < 300) {
      return setDurableWebhookOutcome(webhook, 'success', { httpStatus, responseTimeMs });
    }
    terminalFailure = httpStatus < 500 && ![408, 425, 429].includes(httpStatus);
  } catch (err) {
    responseTimeMs = Date.now() - startedAt;
    terminalFailure = err?.code === 'UNSAFE_URL';
  }

  const maxAttempts = Number(webhook.max_retries ?? 5) + 1;
  const exhausted = Number(webhook.attempt_number) >= maxAttempts;
  const status = terminalFailure || exhausted ? 'dead_letter' : 'retrying';
  return setDurableWebhookOutcome(webhook, status, {
    httpStatus,
    responseTimeMs,
    nextRetry: status === 'retrying'
      ? nextRetryAt(backoffMs(Number(webhook.attempt_number)))
      : null,
  });
}

function signingSecret(webhook) {
  return webhook?.secret_encrypted ? decrypt(webhook.secret_encrypted) : null;
}

// ---------------------------------------------------------------------------
// Backoff helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the next retry delay in milliseconds using exponential backoff
 * with full jitter: delay = rand(0, min(cap, base * 2^attempt)).
 * Base = 10 s, cap = 3 600 s (1 h).
 *
 * @param {number} attemptNumber - The attempt that just failed (1-indexed).
 * @returns {number} Milliseconds to wait before the next attempt.
 */
function backoffMs(attemptNumber) {
  const baseSec = 10;
  const capSec = 3600;
  const ceiling = Math.min(capSec, baseSec * (2 ** (attemptNumber - 1)));
  return Math.floor(Math.random() * ceiling) * 1000 + 1000; // at least 1 s
}

/**
 * Return a MySQL DATETIME string offset by `delayMs` from now.
 */
function nextRetryAt(delayMs) {
  return new Date(Date.now() + delayMs).toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Normalize a stored `events` value into an array of event names. The column is
 * JSON (persisted as a JSON-array string), but tolerate an already-parsed array
 * and a legacy comma-separated string so matching is robust either way.
 * @param {string|string[]|null} raw
 * @returns {string[]}
 */
function parseEventList(raw) {
  if (Array.isArray(raw)) return raw.map(e => String(e).trim()).filter(Boolean);
  if (raw === null || raw === undefined) return [];
  const str = String(raw).trim();
  if (!str) return [];
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed.map(e => String(e).trim()).filter(Boolean);
    } catch (_e) { /* fall through to CSV parsing */ }
  }
  return str.split(',').map(e => e.trim()).filter(Boolean);
}

/**
 * Dispatch an event to all matching webhooks for an organization.
 *
 * When REDIS_URL is set (BullMQ available): each webhook delivery is enqueued
 * as a separate BullMQ job — non-blocking, with native retry/backoff.
 *
 * Fallback (no Redis): each webhook gets exactly one HTTP attempt inline;
 * failures are queued for background retry via processRetries().
 */
async function dispatch(organizationId, event, payload, options = {}) {
  if (!config.features.webhooks) return { dispatched: 0, results: [], reason: 'feature_disabled' };
  // SNMP traps have a dedicated, tenant-scoped forwarding outbox with SSRF
  // protection, bounded payloads, retries, and delivery history. Never let a
  // direct or wildcard generic webhook subscription bypass that boundary.
  if (isReservedTrapEvent(event)) {
    return { dispatched: 0, results: [] };
  }
  const organizationState = await getOwningOrganizationState(organizationId);
  if (!organizationState.active) {
    return { dispatched: 0, results: [], reason: 'organization_inactive' };
  }

  const [webhooks] = await db.query(
    `SELECT * FROM webhooks
      WHERE organization_id = ? AND is_active = 1 AND deleted_at IS NULL
      ORDER BY id ASC LIMIT ${MAX_ACTIVE_WEBHOOKS_PER_ORG + 1}`,
    [organizationId],
  );

  if (webhooks.length > MAX_ACTIVE_WEBHOOKS_PER_ORG) {
    logger.warn?.(
      { organizationId, limit: MAX_ACTIVE_WEBHOOKS_PER_ORG },
      'Active webhook fan-out exceeded the hard organization limit; excess targets skipped',
    );
  }

  const excluded = new Set((options.excludeWebhookIds || []).map(Number));
  const matching = webhooks.slice(0, MAX_ACTIVE_WEBHOOKS_PER_ORG).filter(w => {
    const events = parseEventList(w.events);
    return !excluded.has(Number(w.id)) && (events.includes(event) || events.includes('*'));
  });

  // Persist every delivery before queueing it. Both BullMQ and the bounded
  // in-process fallback receive only a durable row ID, so dispatch never runs
  // up to 50 slow external requests sequentially and Redis never retains the
  // tenant payload.
  const jobQueue = require('./jobQueueService');
  const results = await Promise.all(matching.map(async (webhook) => {
    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
    const [insert] = await db.query(
      `INSERT INTO webhook_deliveries
         (webhook_id, organization_epoch, event_name, payload, target_url,
          attempt_number, recovery_count, status, next_retry_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 'pending', NOW())`,
      [webhook.id, organizationState.epoch, event, body, webhook.url],
    );
    const deliveryId = Number(insert?.insertId);
    try {
      const job = await jobQueue.add('webhook-delivery', {
        deliveryId,
        organizationId,
      }, {
        jobId: `webhook-delivery-${organizationId}-${deliveryId}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      return {
        webhook_id: webhook.id,
        delivery_id: deliveryId,
        status: job.status === 'queued' ? 'queued' : 'pending',
        job_id: job.id,
      };
    } catch (err) {
      // The database row is authoritative. A bounded producer failure must
      // return promptly; the scheduled pending/retry sweep recovers it.
      logger.warn({ err, deliveryId, organizationId }, 'Webhook delivery remains pending after queue failure');
      return { webhook_id: webhook.id, delivery_id: deliveryId, status: 'pending' };
    }
  }));
  return { dispatched: results.length, results };
}

// ---------------------------------------------------------------------------
// Core delivery (single attempt)
// ---------------------------------------------------------------------------

/**
 * Make a single HTTP delivery attempt.  On success the delivery row is marked
 * 'success'.  On failure a 'retrying' row is written (or existing row updated)
 * with next_retry_at set according to backoff — unless max_retries is already
 * exhausted, in which case the row is marked 'dead_letter'.
 *
 * @param {object} webhook   - Webhook record (must have id, url, secret_encrypted,
 *                             max_retries, timeout_seconds).
 * @param {string} event     - Event name (e.g. "invoice.created").
 * @param {object} payload   - Event data object.
 * @param {number} attemptNumber - 1-indexed attempt counter.
 * @param {number|null} deliveryRowId - If retrying an existing row, pass its id.
 * @returns {Promise<object>} Result with { webhook_id, status, attempt_number }.
 */
async function deliverOnce(webhook, event, payload, attemptNumber, deliveryRowId = null) {
  if (!config.features.webhooks) {
    return { webhook_id: webhook?.id, status: 'webhook_disabled', attempt_number: attemptNumber };
  }
  if (isReservedTrapEvent(event)) {
    return {
      ...(await terminalizeReservedTrapDelivery(deliveryRowId, webhook?.id)),
      attempt_number: attemptNumber,
    };
  }
  const organizationState = await getOwningOrganizationState(webhook?.organization_id);
  if (!organizationState.active) {
    if (deliveryRowId) {
      await terminalizeInactiveOrganizationDelivery(deliveryRowId, webhook?.organization_id);
    }
    return {
      webhook_id: webhook?.id,
      status: 'dead_letter',
      reason: 'organization_inactive',
      attempt_number: attemptNumber,
    };
  }
  if (deliveryRowId) {
    const [deliveryRows] = await db.query(
      `SELECT wd.organization_epoch, wd.target_url
         FROM webhook_deliveries wd
         JOIN webhooks w ON w.id = wd.webhook_id
        WHERE wd.id = ? AND wd.webhook_id = ? AND w.organization_id = ?
        LIMIT 1`,
      [deliveryRowId, webhook.id, webhook.organization_id],
    );
    if (!deliveryRows[0]
        || Number(deliveryRows[0].organization_epoch) !== Number(organizationState.epoch)
        || String(deliveryRows[0].target_url || '') !== String(webhook.url || '')) {
      await terminalizeInactiveOrganizationDelivery(deliveryRowId, webhook.organization_id);
      return {
        webhook_id: webhook?.id,
        status: 'dead_letter',
        reason: 'organization_lifecycle_changed',
        attempt_number: attemptNumber,
      };
    }
  }
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  const secret = signingSecret(webhook);
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(body).digest('hex')
    : null;

  const maxRetries = webhook.max_retries !== null && webhook.max_retries !== undefined
    ? webhook.max_retries : 5;
  const timeout = (webhook.timeout_seconds || 10) * 1000;
  const startTime = Date.now();

  let httpStatus = null;
  let responseTimeMs;
  let ok = false;
  let lastError = null;
  let terminalFailure = false;

  try {
    const response = await httpPost(webhook.url, body, {
      'Content-Type': 'application/json',
      'X-FireISP-Event': event,
      ...(signature && { 'X-FireISP-Signature': `sha256=${signature}` }),
    }, timeout);

    responseTimeMs = Date.now() - startTime;
    httpStatus = response.statusCode;
    ok = httpStatus >= 200 && httpStatus < 300;
    if (!ok) lastError = `HTTP ${httpStatus}`;
  } catch (err) {
    responseTimeMs = Date.now() - startTime;
    const code = /^[A-Z0-9_]{2,40}$/.test(String(err?.code || '')) ? err.code : null;
    lastError = code ? `HTTPS delivery failed (${code}).` : 'HTTPS delivery failed.';
    terminalFailure = err?.code === 'UNSAFE_URL';
  }

  if (ok) {
    // ---- success path -------------------------------------------------------
    if (deliveryRowId) {
      await db.query(
        `UPDATE webhook_deliveries
         SET http_status_code = ?, response_body = ?, response_time_ms = ?,
             attempt_number = ?, status = 'success', delivered_at = NOW(),
             next_retry_at = NULL
         WHERE id = ? AND webhook_id = ?`,
        [httpStatus, null, responseTimeMs, attemptNumber, deliveryRowId, webhook.id],
      ).catch(() => {});
    } else {
      await db.query(
        `INSERT INTO webhook_deliveries
         (webhook_id, organization_epoch, event_name, payload, target_url, http_status_code, response_body,
          response_time_ms, attempt_number, recovery_count, status, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'success', NOW())`,
        [webhook.id, organizationState.epoch, event, body, webhook.url,
          httpStatus, null, responseTimeMs, attemptNumber],
      ).catch(() => {});
    }
    return { webhook_id: webhook.id, status: 'success', attempt_number: attemptNumber };
  }

  // ---- failure path ---------------------------------------------------------
  const retriesLeft = maxRetries - attemptNumber;
  const newStatus = !terminalFailure && retriesLeft > 0 ? 'retrying' : 'dead_letter';
  const scheduledAt = retriesLeft > 0 ? nextRetryAt(backoffMs(attemptNumber)) : null;

  if (deliveryRowId) {
    await db.query(
      `UPDATE webhook_deliveries
       SET http_status_code = ?, response_body = ?, response_time_ms = ?,
           attempt_number = ?, status = ?, next_retry_at = ?
       WHERE id = ? AND webhook_id = ?`,
      [httpStatus, null, responseTimeMs, attemptNumber,
        newStatus, scheduledAt, deliveryRowId, webhook.id],
    ).catch(() => {});
  } else {
    await db.query(
      `INSERT INTO webhook_deliveries
       (webhook_id, organization_epoch, event_name, payload, target_url, http_status_code, response_body,
        response_time_ms, attempt_number, recovery_count, status, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [webhook.id, organizationState.epoch, event, body, webhook.url, httpStatus, null, responseTimeMs,
        attemptNumber, newStatus, scheduledAt],
    ).catch(() => {});
  }

  return {
    webhook_id: webhook.id,
    status: newStatus,
    attempt_number: attemptNumber,
    error: lastError,
    next_retry_at: scheduledAt,
  };
}

// ---------------------------------------------------------------------------
// BullMQ worker handler: deliverForWorker()
// ---------------------------------------------------------------------------

/**
 * Handle a BullMQ webhook-delivery job.
 *
 * Job data: { webhookId, organizationId, event, payloadJson, deliveryRowId }
 *   - deliveryRowId is null on the first attempt and is populated (via
 *     job.update) after the INSERT so subsequent retries UPDATE the same row.
 *
 * Throws on transient failure so BullMQ retries with native backoff.
 * Returns normally on success or permanent failure (dead_letter).
 *
 * @param {import('bullmq').Job} job
 */
async function deliverForWorker(job) {
  if (!config.features.webhooks) return { status: 'webhook_disabled' };
  const {
    webhookId,
    organizationId,
    deliveryRowId: existingRowId,
    deliveryId,
  } = job.data;
  if (!Number.isSafeInteger(Number(organizationId)) || Number(organizationId) < 1) {
    return { status: 'webhook_disabled', webhook_id: webhookId };
  }
  const durableDeliveryId = Number(deliveryId || existingRowId);
  const durableJob = Number.isSafeInteger(durableDeliveryId) && durableDeliveryId > 0;
  if (!durableJob) {
    // Pre-459 jobs could embed payloadJson and follow the webhook's current URL.
    // They have no immutable destination, organization epoch, or SQL ownership
    // record, so replaying one after an upgrade could bypass revocation. Current
    // producers always queue a durable delivery ID; reject rowless legacy jobs
    // without a lookup or external request.
    return { status: 'legacy_job_rejected', webhook_id: webhookId };
  }
  return deliverDurableWebhook(durableDeliveryId, Number(organizationId));
}



/**
 * Process all webhook deliveries that are due for retry.
 * Called by the webhook_retry scheduled task every 5 minutes.
 * Fetches up to 100 due/stale rows and requeues their durable IDs. Only the
 * ownership-CAS worker may perform external I/O.
 */
async function processCurrentDatabaseRetries({ organizationId = null, excludeOrganizationIds = [] } = {}) {
  const excluded = [...new Set(excludeOrganizationIds
    .map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  const params = [];
  let organizationPredicate = '';
  if (organizationId !== null && organizationId !== undefined) {
    organizationPredicate = ' AND w.organization_id = ?';
    params.push(organizationId);
  } else if (excluded.length) {
    organizationPredicate = ` AND w.organization_id NOT IN (${excluded.map(() => '?').join(', ')})`;
    params.push(...excluded);
  }
  const orphanAwareOrganizationPredicate = organizationId !== null && organizationId !== undefined
    ? ' AND (w.id IS NULL OR w.organization_id = ?)'
    : (excluded.length
      ? ` AND (w.id IS NULL OR w.organization_id NOT IN (${excluded.map(() => '?').join(', ')}))`
      : '');
  // A configuration mutation may happen while a worker owns an attempt. The
  // live owner may finish once, but a crashed attempt must not remain stuck or
  // be recovered after an A-to-B-to-A URL change. Missing registrations are
  // included defensively even though the foreign key normally cascades them.
  await db.query(
    `UPDATE webhook_deliveries wd
       LEFT JOIN webhooks w ON w.id = wd.webhook_id
        SET wd.status = 'dead_letter', wd.locked_at = NULL,
            wd.claim_token = NULL, wd.next_retry_at = NULL,
            wd.response_body = NULL
      WHERE ((wd.revoked_at IS NOT NULL AND wd.status IN ('pending','retrying'))
          OR (wd.status = 'processing'
            AND wd.locked_at < DATE_SUB(NOW(), INTERVAL ${WEBHOOK_PROCESSING_STALE_MINUTES} MINUTE)
            AND (wd.revoked_at IS NOT NULL OR w.id IS NULL OR w.is_active <> 1
              OR w.deleted_at IS NOT NULL OR wd.target_url IS NULL
              OR NOT (BINARY wd.target_url <=> BINARY w.url))))${orphanAwareOrganizationPredicate}`,
    params,
  );
  // A worker that repeatedly dies after taking the final allowed claim must
  // not be reclaimed forever. Terminalize it before selecting recoverable IDs.
  await db.query(
    `UPDATE webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
        SET wd.status = 'dead_letter', wd.locked_at = NULL,
            wd.claim_token = NULL, wd.next_retry_at = NULL,
            wd.response_body = NULL
      WHERE wd.status = 'processing'
        AND wd.locked_at < DATE_SUB(NOW(), INTERVAL ${WEBHOOK_PROCESSING_STALE_MINUTES} MINUTE)
        AND wd.attempt_number >= (COALESCE(w.max_retries, 5) + 1)
        AND wd.recovery_count >= 1${organizationPredicate}`,
    params,
  );
  // A URL rotation that won the race before this outbox row was inserted is
  // still fail-closed: the immutable snapshot never follows the current
  // registration to a different endpoint.
  await db.query(
    `UPDATE webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
        SET wd.status = 'dead_letter', wd.locked_at = NULL,
            wd.claim_token = NULL, wd.next_retry_at = NULL,
            wd.response_body = NULL
      WHERE wd.status IN ('pending','retrying')
        AND (wd.target_url IS NULL OR NOT (BINARY wd.target_url <=> BINARY w.url))${organizationPredicate}`,
    params,
  );
  const [pending] = await db.query(
    `SELECT wd.id AS delivery_id,
            wd.event_name, wd.payload, wd.attempt_number, wd.organization_epoch,
            w.id AS webhook_id, w.organization_id, w.url, w.secret_encrypted,
            w.max_retries, w.timeout_seconds
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id AND w.is_active = 1 AND w.deleted_at IS NULL
     WHERE BINARY wd.target_url = BINARY w.url
       AND wd.revoked_at IS NULL
       AND ((wd.status IN ('pending','retrying')
          AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= NOW()))
        OR (wd.status = 'processing'
          AND wd.locked_at < DATE_SUB(NOW(), INTERVAL ${WEBHOOK_PROCESSING_STALE_MINUTES} MINUTE)))${organizationPredicate}
     ORDER BY wd.next_retry_at ASC
     LIMIT 100`,
    params,
  );

  let queued = 0;
  let failed = 0;
  let deadLettered = 0;
  const activeByOrganization = new Map();
  for (const row of pending) {
    const ownerId = Number(row.organization_id);
    if (!activeByOrganization.has(ownerId)) {
      activeByOrganization.set(ownerId, await getOwningOrganizationState(ownerId));
    }
  }
  const eligible = [];
  for (const row of pending) {
    const owner = activeByOrganization.get(Number(row.organization_id));
    if (owner?.active && Number(row.organization_epoch) === Number(owner.epoch)) {
      eligible.push(row);
    } else {
      await terminalizeInactiveOrganizationDelivery(row.delivery_id, row.organization_id);
      deadLettered++;
    }
  }
  const jobQueue = require('./jobQueueService');
  const settled = await Promise.allSettled(eligible.map(row => jobQueue.add(
    'webhook-delivery',
    { deliveryId: Number(row.delivery_id), organizationId: Number(row.organization_id) },
    {
      jobId: `webhook-delivery-${row.organization_id}-${row.delivery_id}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  )));
  settled.forEach(result => {
    if (result.status === 'fulfilled' && result.value?.status === 'queued') queued++;
    else failed++;
  });
  return {
    succeeded: 0,
    queued,
    failed,
    dead_lettered: deadLettered,
    total: pending.length,
  };
}

function mergeRetryResults(target, result) {
  target.succeeded += result.succeeded;
  target.failed += result.failed;
  target.dead_lettered += result.dead_lettered;
  target.total += result.total;
  target.queued = Number(target.queued || 0) + Number(result.queued || 0);
}

/**
 * Process generic webhook retries in their owning database. Primary rows for
 * isolated organizations are excluded before isolated fan-out, preventing a
 * stale primary row from colliding with an unrelated same-ID isolated row.
 */
async function processRetries(organizationId = null) {
  if (!config.features.webhooks) {
    return { succeeded: 0, failed: 0, dead_lettered: 0, total: 0, reason: 'feature_disabled' };
  }
  if (organizationId !== null && organizationId !== undefined) {
    const run = () => processCurrentDatabaseRetries({ organizationId });
    return typeof db.withTenantContext === 'function'
      ? db.withTenantContext(organizationId, run)
      : run();
  }
  if (typeof db.withPrimaryContext !== 'function' || typeof db.withTenantContext !== 'function') {
    return processCurrentDatabaseRetries();
  }

  const [isolated] = await db.withPrimaryContext(() => db.query(
    `SELECT odc.organization_id, o.status, o.deleted_at
       FROM organization_database_configs odc
       JOIN organizations o ON o.id = odc.organization_id
      WHERE odc.isolation_mode = 'isolated'
      ORDER BY odc.organization_id`,
  ));
  const isolatedIds = isolated
    .map(row => Number(row.organization_id))
    .filter(Number.isSafeInteger);
  const total = { succeeded: 0, queued: 0, failed: 0, dead_lettered: 0, total: 0 };
  mergeRetryResults(total, await db.withPrimaryContext(
    () => processCurrentDatabaseRetries({ excludeOrganizationIds: isolatedIds }),
  ));
  for (const row of isolated) {
    try {
      // Enter retained isolated databases even when their owning organization
      // is suspended/deleted. The sweep must terminalize their unclaimed rows;
      // silently skipping the database would leave them ready to surprise-send
      // after a later reactivation.
      const result = await db.withTenantContext(
        row.organization_id,
        () => processCurrentDatabaseRetries({ organizationId: row.organization_id }),
      );
      mergeRetryResults(total, result);
    } catch (_err) {
      total.failed++;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Dead-letter management
// ---------------------------------------------------------------------------

/**
 * List dead-letter deliveries for an organization.
 */
async function listDeadLetters(organizationId, limit = 50) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
  // webhooks has no `name` column — `description` is its closest equivalent
  // (a nullable free-text label; database/schema.sql).
  const [rows] = await db.query(
    `SELECT wd.id, wd.webhook_id, wd.event_name, wd.http_status_code,
            wd.response_time_ms, wd.attempt_number, wd.status,
            wd.next_retry_at, wd.delivered_at, wd.created_at,
            w.description AS name
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE w.organization_id = ? AND wd.status = 'dead_letter'
     ORDER BY wd.created_at DESC LIMIT ${safeLimit}`,
    [organizationId],
  );
  return rows;
}

/**
 * Re-deliver a specific dead-letter delivery (resets to attempt 1).
 */
async function redeliverDeadLetter(deliveryId, organizationId) {
  if (!config.features.webhooks) return { status: 'webhook_disabled' };
  const organizationState = await getOwningOrganizationState(organizationId);
  if (!organizationState.active) {
    return { status: 'dead_letter', reason: 'organization_inactive' };
  }
  const [rows] = await db.query(
    `SELECT wd.id, wd.event_name, wd.payload, wd.target_url, wd.organization_epoch,
            w.id AS webhook_id, w.organization_id AS webhook_organization_id,
            w.url, w.secret_encrypted,
            w.max_retries, w.timeout_seconds
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.id = ? AND wd.status = 'dead_letter'
       AND w.organization_id = ? AND w.deleted_at IS NULL`,
    [deliveryId, organizationId],
  );

  if (rows.length === 0) {
    return { status: 'not_found' };
  }

  const row = rows[0];
  if (Number(row.webhook_organization_id) !== Number(organizationId)) {
    return { status: 'not_found' };
  }
  if (Number(row.organization_epoch) !== Number(organizationState.epoch)) {
    return {
      status: 'dead_letter',
      webhook_id: row.webhook_id,
      reason: 'organization_lifecycle_changed',
    };
  }
  if (isReservedTrapEvent(row.event_name)) {
    return terminalizeReservedTrapDelivery(row.id, row.webhook_id);
  }
  if (!row.target_url || String(row.target_url) !== String(row.url)) {
    await db.query(
      `UPDATE webhook_deliveries
          SET status = 'dead_letter', next_retry_at = NULL,
              response_body = NULL, locked_at = NULL, claim_token = NULL
        WHERE id = ? AND webhook_id = ?`,
      [row.id, row.webhook_id],
    ).catch(() => {});
    return {
      status: 'dead_letter',
      webhook_id: row.webhook_id,
      error: 'Webhook destination changed after this delivery was queued.',
    };
  }
  try {
    await assertSafeOutboundUrl(row.url, 'webhook URL');
  } catch (_err) {
    await db.query(
      `UPDATE webhook_deliveries
          SET status = 'dead_letter', next_retry_at = NULL,
              response_body = NULL, locked_at = NULL, claim_token = NULL
        WHERE id = ? AND webhook_id = ?`,
      [row.id, row.webhook_id],
    ).catch(() => {});
    return {
      status: 'dead_letter',
      webhook_id: row.webhook_id,
      error: 'Webhook destination is not a safe public HTTPS URL.',
    };
  }
  // Reset status and enqueue the durable ID. The worker's atomic claim is the
  // only code path that may perform external I/O.
  const [reset] = await db.query(
    `UPDATE webhook_deliveries
        SET status = 'retrying', attempt_number = 0, recovery_count = 0,
            next_retry_at = NOW(), locked_at = NULL, claim_token = NULL,
            revoked_at = NULL,
            http_status_code = NULL, response_body = NULL,
            response_time_ms = NULL, delivered_at = NULL,
            created_at = NOW()
      WHERE id = ? AND webhook_id = ? AND status = 'dead_letter'`,
    [deliveryId, row.webhook_id],
  );
  if (!reset?.affectedRows) return { status: 'not_found' };
  const jobQueue = require('./jobQueueService');
  await jobQueue.add(
    'webhook-delivery',
    { deliveryId: Number(row.id), organizationId: Number(organizationId) },
    {
      jobId: `webhook-delivery-${organizationId}-${row.id}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
  return { status: 'pending', delivery_id: Number(row.id) };
}

/**
 * Mark an existing delivery row as dead-letter explicitly.
 */
async function markDeadLetter(webhookId, eventName, lastError) {
  await db.query(
    `UPDATE webhook_deliveries
     SET status = 'dead_letter', next_retry_at = NULL
     WHERE webhook_id = ? AND event_name = ? AND status IN ('failed','retrying')
     ORDER BY created_at DESC LIMIT 1`,
    [webhookId, eventName],
  );
  return { webhook_id: webhookId, status: 'dead_letter', error: lastError };
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

function httpPost(url, body, headers, timeout) {
  return safeHttpsPost(
    url,
    body,
    headers,
    Math.min(
      WEBHOOK_ABSOLUTE_TIMEOUT_MS,
      Math.max(1, Number(timeout) || WEBHOOK_ABSOLUTE_TIMEOUT_MS),
    ),
    'webhook URL',
  );
}

// ---------------------------------------------------------------------------
// Backward-compat helpers
// ---------------------------------------------------------------------------

/**
 * deliver() kept for backward compatibility.
 * Wraps deliverOnce() starting at attempt 1.
 */
async function deliver(webhook, event, payload) {
  return deliverOnce(webhook, event, payload, 1);
}

module.exports = {
  dispatch,
  deliver,
  deliverOnce,
  deliverForWorker,
  processRetries,
  markDeadLetter,
  listDeadLetters,
  redeliverDeadLetter,
  backoffMs,
  httpPost,
  WEBHOOK_ABSOLUTE_TIMEOUT_MS,
  MAX_WEBHOOK_HEADER_BYTES,
  MAX_WEBHOOK_RESPONSE_BYTES,
  MAX_ACTIVE_WEBHOOKS_PER_ORG,
  WEBHOOK_PROCESSING_STALE_MINUTES,
  isReservedTrapEvent,
  claimDurableWebhookDelivery,
  deliverDurableWebhook,
  isOwningOrganizationActive,
};
