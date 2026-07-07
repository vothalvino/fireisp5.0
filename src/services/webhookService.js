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
const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('../config/database');

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
async function dispatch(organizationId, event, payload) {
  const [webhooks] = await db.query(
    'SELECT * FROM webhooks WHERE organization_id = ? AND is_active = 1',
    [organizationId],
  );

  const matching = webhooks.filter(w => {
    const events = parseEventList(w.events);
    return events.includes(event) || events.includes('*');
  });

  // BullMQ path: enqueue each delivery as a non-blocking job
  if (process.env.REDIS_URL) {
    const jobQueue = require('./jobQueueService');
    const results = await Promise.all(matching.map(async (webhook) => {
      const maxRetries = webhook.max_retries ?? 5;
      const job = await jobQueue.add('webhook-delivery', {
        webhookId: webhook.id,
        event,
        payloadJson: JSON.stringify(payload),
        deliveryRowId: null,
      }, {
        attempts: maxRetries + 1,
        backoff: { type: 'exponential', delay: 10000 },
      });
      return { webhook_id: webhook.id, status: 'queued', job_id: job.id };
    }));
    return { dispatched: results.length, results };
  }

  // Fallback: inline delivery (no Redis)
  const results = [];
  for (const webhook of matching) {
    const result = await deliverOnce(webhook, event, payload, 1);
    results.push(result);
  }

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
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  const signature = webhook.secret_encrypted
    ? crypto.createHmac('sha256', webhook.secret_encrypted).update(body).digest('hex')
    : null;

  const maxRetries = webhook.max_retries !== null && webhook.max_retries !== undefined
    ? webhook.max_retries : 5;
  const timeout = (webhook.timeout_seconds || 10) * 1000;
  const startTime = Date.now();

  let httpStatus = null;
  let responseBody = null;
  let responseTimeMs;
  let ok = false;
  let lastError = null;

  try {
    const response = await httpPost(webhook.url, body, {
      'Content-Type': 'application/json',
      'X-FireISP-Event': event,
      ...(signature && { 'X-FireISP-Signature': `sha256=${signature}` }),
    }, timeout);

    responseTimeMs = Date.now() - startTime;
    httpStatus = response.statusCode;
    responseBody = response.body ? response.body.slice(0, 4096) : null;
    ok = httpStatus >= 200 && httpStatus < 300;
    if (!ok) lastError = `HTTP ${httpStatus}`;
  } catch (err) {
    responseTimeMs = Date.now() - startTime;
    lastError = err.message;
  }

  if (ok) {
    // ---- success path -------------------------------------------------------
    if (deliveryRowId) {
      await db.query(
        `UPDATE webhook_deliveries
         SET http_status_code = ?, response_body = ?, response_time_ms = ?,
             attempt_number = ?, status = 'success', delivered_at = NOW(),
             next_retry_at = NULL
         WHERE id = ?`,
        [httpStatus, responseBody, responseTimeMs, attemptNumber, deliveryRowId],
      ).catch(() => {});
    } else {
      await db.query(
        `INSERT INTO webhook_deliveries
         (webhook_id, event_name, payload, http_status_code, response_body,
          response_time_ms, attempt_number, status, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'success', NOW())`,
        [webhook.id, event, body, httpStatus, responseBody, responseTimeMs, attemptNumber],
      ).catch(() => {});
    }
    return { webhook_id: webhook.id, status: 'success', attempt_number: attemptNumber };
  }

  // ---- failure path ---------------------------------------------------------
  const retriesLeft = maxRetries - attemptNumber;
  const newStatus = retriesLeft > 0 ? 'retrying' : 'dead_letter';
  const scheduledAt = retriesLeft > 0 ? nextRetryAt(backoffMs(attemptNumber)) : null;

  if (deliveryRowId) {
    await db.query(
      `UPDATE webhook_deliveries
       SET http_status_code = ?, response_body = ?, response_time_ms = ?,
           attempt_number = ?, status = ?, next_retry_at = ?
       WHERE id = ?`,
      [httpStatus, responseBody, responseTimeMs, attemptNumber,
        newStatus, scheduledAt, deliveryRowId],
    ).catch(() => {});
  } else {
    await db.query(
      `INSERT INTO webhook_deliveries
       (webhook_id, event_name, payload, http_status_code, response_body,
        response_time_ms, attempt_number, status, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [webhook.id, event, body, httpStatus, responseBody, responseTimeMs,
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
 * Job data: { webhookId, event, payloadJson, deliveryRowId }
 *   - deliveryRowId is null on the first attempt and is populated (via
 *     job.update) after the INSERT so subsequent retries UPDATE the same row.
 *
 * Throws on transient failure so BullMQ retries with native backoff.
 * Returns normally on success or permanent failure (dead_letter).
 *
 * @param {import('bullmq').Job} job
 */
async function deliverForWorker(job) {
  const { webhookId, event, payloadJson, deliveryRowId: existingRowId } = job.data;
  const attemptNumber = (job.attemptsMade || 0) + 1;
  // BullMQ opts.attempts counts all attempts (including first); subtract 1 for retries remaining
  const maxAttempts = job.opts?.attempts || 6;
  const isFinalAttempt = attemptNumber >= maxAttempts;

  const [webhooks] = await db.query(
    'SELECT * FROM webhooks WHERE id = ? AND is_active = 1',
    [webhookId],
  );

  if (!webhooks.length) {
    // Webhook disabled or deleted — stop retrying
    return { status: 'webhook_disabled', webhook_id: webhookId };
  }

  const webhook = webhooks[0];
  let payload;
  try {
    payload = payloadJson ? JSON.parse(payloadJson) : {};
  } catch (_) {
    payload = {};
  }

  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  const signature = webhook.secret_encrypted
    ? crypto.createHmac('sha256', webhook.secret_encrypted).update(body).digest('hex')
    : null;
  const timeout = (webhook.timeout_seconds || 10) * 1000;
  const startTime = Date.now();

  let httpStatus = null;
  let responseBody = null;
  let responseTimeMs;
  let ok = false;
  let lastError = null;

  try {
    const response = await httpPost(webhook.url, body, {
      'Content-Type': 'application/json',
      'X-FireISP-Event': event,
      ...(signature && { 'X-FireISP-Signature': `sha256=${signature}` }),
    }, timeout);

    responseTimeMs = Date.now() - startTime;
    httpStatus = response.statusCode;
    responseBody = response.body ? response.body.slice(0, 4096) : null;
    ok = httpStatus >= 200 && httpStatus < 300;
    if (!ok) lastError = `HTTP ${httpStatus}`;
  } catch (err) {
    responseTimeMs = Date.now() - startTime;
    lastError = err.message;
  }

  if (ok) {
    if (existingRowId) {
      await db.query(
        `UPDATE webhook_deliveries
         SET http_status_code = ?, response_body = ?, response_time_ms = ?,
             attempt_number = ?, status = 'success', delivered_at = NOW(),
             next_retry_at = NULL
         WHERE id = ?`,
        [httpStatus, responseBody, responseTimeMs, attemptNumber, existingRowId],
      ).catch(() => {});
    } else {
      await db.query(
        `INSERT INTO webhook_deliveries
         (webhook_id, event_name, payload, http_status_code, response_body,
          response_time_ms, attempt_number, status, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'success', NOW())`,
        [webhook.id, event, body, httpStatus, responseBody, responseTimeMs, attemptNumber],
      ).catch(() => {});
    }
    return { webhook_id: webhook.id, status: 'success', attempt_number: attemptNumber };
  }

  // Failure — determine final vs transient
  const newStatus = isFinalAttempt ? 'dead_letter' : 'retrying';

  if (existingRowId) {
    await db.query(
      `UPDATE webhook_deliveries
       SET http_status_code = ?, response_body = ?, response_time_ms = ?,
           attempt_number = ?, status = ?, next_retry_at = NULL
       WHERE id = ?`,
      [httpStatus, responseBody, responseTimeMs, attemptNumber, newStatus, existingRowId],
    ).catch(() => {});
  } else {
    // First attempt — INSERT and persist rowId in job data for later retries
    try {
      const [insertResult] = await db.query(
        `INSERT INTO webhook_deliveries
         (webhook_id, event_name, payload, http_status_code, response_body,
          response_time_ms, attempt_number, status, next_retry_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [webhook.id, event, body, httpStatus, responseBody, responseTimeMs, attemptNumber, newStatus],
      );
      if (insertResult?.insertId && typeof job.update === 'function') {
        await job.update({ ...job.data, deliveryRowId: insertResult.insertId }).catch(() => {});
      }
    } catch (_err) {
      // Audit row failure must not block the retry cycle
    }
  }

  if (!isFinalAttempt) {
    throw new Error(`Webhook delivery failed (attempt ${attemptNumber}): ${lastError || 'HTTP error'}`);
  }

  return { webhook_id: webhook.id, status: 'dead_letter', attempt_number: attemptNumber, error: lastError };
}



/**
 * Process all webhook deliveries that are due for retry.
 * Called by the webhook_retry scheduled task every 5 minutes.
 * Fetches up to 100 'retrying' rows whose next_retry_at is in the past,
 * makes one HTTP attempt per row, updates status accordingly.
 */
async function processRetries() {
  const [pending] = await db.query(
    `SELECT wd.id AS delivery_id,
            wd.event_name, wd.payload, wd.attempt_number,
            w.id AS webhook_id, w.url, w.secret_encrypted,
            w.max_retries, w.timeout_seconds
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id AND w.is_active = 1
     WHERE wd.status = 'retrying'
       AND wd.next_retry_at <= NOW()
     ORDER BY wd.next_retry_at ASC
     LIMIT 100`,
  );

  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of pending) {
    let payload;
    try {
      payload = row.payload ? JSON.parse(row.payload) : {};
      // payload stored as full body: { event, data, timestamp } — extract data
      if (payload.data !== undefined) payload = payload.data;
    } catch (_err) {
      payload = {};
    }

    const webhook = {
      id: row.webhook_id,
      url: row.url,
      secret_encrypted: row.secret_encrypted,
      max_retries: row.max_retries,
      timeout_seconds: row.timeout_seconds,
    };

    const nextAttempt = (row.attempt_number || 1) + 1;
    const result = await deliverOnce(webhook, row.event_name, payload, nextAttempt, row.delivery_id);

    if (result.status === 'success') succeeded++;
    else if (result.status === 'dead_letter') deadLettered++;
    else failed++;
  }

  return { succeeded, failed, dead_lettered: deadLettered, total: pending.length };
}

// ---------------------------------------------------------------------------
// Dead-letter management
// ---------------------------------------------------------------------------

/**
 * List dead-letter deliveries for an organization.
 */
async function listDeadLetters(organizationId, limit = 50) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
  const [rows] = await db.query(
    `SELECT wd.*, w.url, w.name
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
async function redeliverDeadLetter(deliveryId) {
  const [rows] = await db.query(
    `SELECT wd.id, wd.event_name, wd.payload,
            w.id AS webhook_id, w.url, w.secret_encrypted,
            w.max_retries, w.timeout_seconds
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.id = ? AND wd.status = 'dead_letter'`,
    [deliveryId],
  );

  if (rows.length === 0) {
    return { status: 'not_found' };
  }

  const row = rows[0];
  let payload;
  try {
    payload = row.payload ? JSON.parse(row.payload) : {};
    if (payload.data !== undefined) payload = payload.data;
  } catch (_err) {
    payload = {};
  }

  // Reset status so the attempt is counted fresh
  await db.query(
    "UPDATE webhook_deliveries SET status = 'retrying', next_retry_at = NOW() WHERE id = ?",
    [deliveryId],
  );

  const webhook = {
    id: row.webhook_id,
    url: row.url,
    secret_encrypted: row.secret_encrypted,
    max_retries: row.max_retries,
    timeout_seconds: row.timeout_seconds,
  };

  return deliverOnce(webhook, row.event_name, payload, 1, row.id);
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

/**
 * Simple HTTP/HTTPS POST using built-in Node modules.
 */
function httpPost(url, body, headers, timeout) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
};
