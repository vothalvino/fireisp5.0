// =============================================================================
// FireISP 5.0 — Webhook Delivery Service
// =============================================================================
// Delivers outbound webhook events with HMAC-SHA256 signing and retry logic.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');

/**
 * Sign a payload with HMAC-SHA256 using the webhook's secret.
 * @param {string} payload - JSON string to sign
 * @param {string} secret - HMAC signing secret
 * @returns {string} Hex-encoded signature
 */
function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Deliver a single webhook event to a target URL.
 *
 * @param {object} webhook - Webhook record from the database
 * @param {string} eventName - Event name (e.g. 'invoice.created')
 * @param {object} eventData - Event payload data
 * @returns {Promise<object>} Delivery result
 */
async function deliverEvent(webhook, eventName, eventData) {
  const payload = JSON.stringify({
    event: eventName,
    data: eventData,
    webhook_id: webhook.id,
    timestamp: new Date().toISOString(),
  });

  const signature = webhook.signing_secret
    ? signPayload(payload, webhook.signing_secret)
    : null;

  const timeout = (webhook.timeout_seconds || 30) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const startTime = Date.now();
  let httpStatus = null;
  let responseBody;
  let deliveryStatus;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'FireISP/5.0 Webhook',
      'X-Webhook-Event': eventName,
    };
    if (signature) {
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    }

    const response = await fetch(webhook.target_url, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });

    httpStatus = response.status;
    responseBody = await response.text().catch(() => '');
    deliveryStatus = httpStatus >= 200 && httpStatus < 300 ? 'success' : 'failed';
  } catch (err) {
    responseBody = err.message;
    deliveryStatus = 'failed';
  } finally {
    clearTimeout(timer);
  }

  const responseTimeMs = Date.now() - startTime;

  // Log delivery attempt
  const [result] = await db.query(
    `INSERT INTO webhook_deliveries
       (webhook_id, event_name, http_status, response_body, response_time_ms, attempt_number, status)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [webhook.id, eventName, httpStatus, responseBody, responseTimeMs, deliveryStatus],
  );

  return {
    deliveryId: result.insertId,
    status: deliveryStatus,
    httpStatus,
    responseTimeMs,
  };
}

/**
 * Dispatch a webhook event to all matching subscriptions for an organization.
 *
 * @param {number} organizationId - Organization that owns the webhook
 * @param {string} eventName - Event name (e.g. 'invoice.created')
 * @param {object} eventData - Event payload
 * @returns {Promise<object[]>} Array of delivery results
 */
async function dispatch(organizationId, eventName, eventData) {
  const [webhooks] = await db.query(
    'SELECT * FROM webhooks WHERE organization_id = ? AND is_active = TRUE',
    [organizationId],
  );

  const results = [];

  for (const webhook of webhooks) {
    // Check if this webhook subscribes to the event
    let events;
    try {
      events = typeof webhook.events === 'string' ? JSON.parse(webhook.events) : (webhook.events || []);
    } catch (_err) {
      continue; // Skip webhooks with invalid event config
    }

    // '*' means subscribe to all events, or check for exact match
    if (events.includes('*') || events.includes(eventName)) {
      const result = await deliverEvent(webhook, eventName, eventData);
      results.push(result);
    }
  }

  return results;
}

/**
 * Retry failed webhook deliveries that are eligible for retry.
 * Called by the scheduler.
 */
async function retryFailed() {
  const [deliveries] = await db.query(
    `SELECT wd.*, w.target_url, w.signing_secret, w.max_retries, w.timeout_seconds
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.status = 'failed'
       AND wd.attempt_number < COALESCE(w.max_retries, 5)
       AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= NOW())
     ORDER BY wd.created_at ASC
     LIMIT 100`,
  );

  let retried = 0;

  for (const delivery of deliveries) {
    const webhook = {
      id: delivery.webhook_id,
      target_url: delivery.target_url,
      signing_secret: delivery.signing_secret,
      timeout_seconds: delivery.timeout_seconds,
    };

    const result = await deliverEvent(webhook, delivery.event_name, {});

    // Update the original delivery row with retry info
    const nextAttempt = delivery.attempt_number + 1;
    const backoffMinutes = Math.pow(2, nextAttempt); // Exponential backoff

    await db.query(
      `UPDATE webhook_deliveries
         SET attempt_number = ?, status = ?,
             next_retry_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
       WHERE id = ?`,
      [nextAttempt, result.status, backoffMinutes, delivery.id],
    );

    retried++;
  }

  return { retried };
}

module.exports = { dispatch, deliverEvent, retryFailed, signPayload };
