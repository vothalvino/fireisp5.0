// =============================================================================
// FireISP 5.0 — Webhook Delivery Service
// =============================================================================
// Delivers outbound webhooks with retry logic and HMAC-SHA256 signing.
// =============================================================================

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('../config/database');

/**
 * Dispatch an event to all matching webhooks for an organization.
 */
async function dispatch(organizationId, event, payload) {
  const [webhooks] = await db.query(
    'SELECT * FROM webhooks WHERE organization_id = ? AND is_enabled = 1',
    [organizationId],
  );

  const matching = webhooks.filter(w => {
    const events = (w.events || '').split(',').map(e => e.trim());
    return events.includes(event) || events.includes('*');
  });

  const results = [];
  for (const webhook of matching) {
    const result = await deliver(webhook, event, payload);
    results.push(result);
  }

  return { dispatched: results.length, results };
}

/**
 * Deliver a single webhook with HMAC signing and retry logic.
 */
async function deliver(webhook, event, payload) {
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  const signature = webhook.secret_encrypted
    ? crypto.createHmac('sha256', webhook.secret_encrypted).update(body).digest('hex')
    : null;

  const maxRetries = webhook.max_retries || 3;
  const timeout = (webhook.timeout_seconds || 10) * 1000;

  let lastError = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt++;
    const startTime = Date.now();

    try {
      const response = await httpPost(webhook.url, body, {
        'Content-Type': 'application/json',
        'X-FireISP-Event': event,
        ...(signature && { 'X-FireISP-Signature': `sha256=${signature}` }),
      }, timeout);

      const responseTime = Date.now() - startTime;
      const ok = response.statusCode >= 200 && response.statusCode < 300;

      await db.query(
        `INSERT INTO webhook_deliveries
         (webhook_id, event, request_body, response_status, response_body, response_time_ms, attempt, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [webhook.id, event, body, response.statusCode, response.body, responseTime, attempt,
          ok ? 'success' : 'failed'],
      );

      if (ok) {
        return { webhook_id: webhook.id, status: 'success', attempts: attempt };
      }

      lastError = `HTTP ${response.statusCode}`;
    } catch (err) {
      lastError = err.message;
      const responseTime = Date.now() - startTime;

      await db.query(
        `INSERT INTO webhook_deliveries
         (webhook_id, event, request_body, response_status, response_time_ms, attempt, status)
         VALUES (?, ?, ?, NULL, ?, ?, 'failed')`,
        [webhook.id, event, body, responseTime, attempt],
      ).catch(() => {});
    }

    // Exponential backoff between retries
    if (attempt <= maxRetries) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 30000)));
    }
  }

  return { webhook_id: webhook.id, status: 'failed', attempts: attempt, error: lastError };
}

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

/**
 * Retry all pending webhook deliveries.
 */
async function retryPending() {
  const [pending] = await db.query(
    `SELECT wd.*, w.url, w.secret_encrypted, w.max_retries, w.timeout_seconds
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.status = 'retrying'
     ORDER BY wd.created_at ASC LIMIT 50`,
  );

  let succeeded = 0;
  let failed = 0;

  for (const delivery of pending) {
    const result = await deliver(delivery, delivery.event, delivery.request_body);
    if (result.status === 'success') succeeded++;
    else failed++;
  }

  return { succeeded, failed, total: pending.length };
}

module.exports = { dispatch, deliver, retryPending };
