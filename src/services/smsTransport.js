// =============================================================================
// FireISP 5.0 — SMS Transport Service
// =============================================================================
// Sends SMS (and WhatsApp) messages via a configurable provider.
// Supported providers:
//   twilio   — Twilio REST API (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)
//   generic  — Any provider that accepts an HTTP POST with JSON or form body
//              (SMS_PROVIDER_URL / SMS_PROVIDER_API_KEY / SMS_PROVIDER_FROM)
//
// Usage pattern mirrors emailTransport.js:
//   sendSms()     — immediate fire, logs result to sms_logs
//   processQueue()— called by the 'sms_send' scheduled task to drain queued rows
// =============================================================================

const https = require('https');
const http  = require('http');
const { URLSearchParams } = require('url');
const { URL } = require('url');
const db = require('../config/database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Detect the active provider from environment variables.
 * @returns {'twilio'|'generic'|null}
 */
function detectProvider() {
  if (process.env.SMS_PROVIDER === 'generic' && process.env.SMS_PROVIDER_URL) return 'generic';
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) return 'twilio';
  if (process.env.SMS_PROVIDER_URL) return 'generic';
  return null;
}

/**
 * Send via Twilio REST API (no SDK — built-in https module).
 * @param {object} opts
 * @param {string} opts.to       - E.164 destination number
 * @param {string} opts.body     - Message text
 * @param {'sms'|'whatsapp'} [opts.channel='sms']
 * @returns {Promise<{sid: string, status: string}>}
 */
function sendViaTwilio({ to, body, channel = 'sms' }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  const fromNumber = channel === 'whatsapp'
    ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM}`
    : (process.env.TWILIO_FROM || '');

  const toNumber = channel === 'whatsapp' ? `whatsapp:${to}` : to;

  const postBody = new URLSearchParams({
    To:   toNumber,
    From: fromNumber,
    Body: body,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path:     `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method:   'POST',
      headers:  {
        Authorization:   `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const err = new Error(parsed.message || `Twilio HTTP ${res.statusCode}`);
            err.code = String(parsed.code || res.statusCode);
            reject(err);
          } else {
            resolve({ sid: parsed.sid, status: parsed.status });
          }
        } catch (_parseErr) {
          reject(new Error(`Twilio response parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Twilio request timed out')));
    req.on('error', reject);
    req.write(postBody);
    req.end();
  });
}

/**
 * Send via a generic HTTP provider (e.g. Infobip, MessageBird, local MX gateway).
 * POST JSON to SMS_PROVIDER_URL with { to, from, body } and optional Bearer auth.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.body
 * @param {'sms'|'whatsapp'} [opts.channel='sms']
 * @returns {Promise<{sid: string|null, status: string}>}
 */
function sendViaGeneric({ to, body, channel = 'sms' }) {
  const rawUrl  = process.env.SMS_PROVIDER_URL;
  const apiKey  = process.env.SMS_PROVIDER_API_KEY || '';
  const from    = process.env.SMS_PROVIDER_FROM || process.env.SMS_FROM || '';

  const parsed  = new URL(rawUrl);
  const isHttps = parsed.protocol === 'https:';
  const lib     = isHttps ? https : http;
  const port    = parsed.port || (isHttps ? 443 : 80);

  const payload = JSON.stringify({ to, from, body, channel });

  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const req = lib.request({
      hostname: parsed.hostname,
      port,
      path:    parsed.pathname + (parsed.search || ''),
      method:  'POST',
      headers,
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const result = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            const err = new Error(result.message || result.error || `Provider HTTP ${res.statusCode}`);
            err.code  = String(result.code || res.statusCode);
            reject(err);
          } else {
            resolve({ sid: result.id || result.messageId || null, status: result.status || 'sent' });
          }
        } catch (_parseErr) {
          // Non-JSON 2xx response — treat as success
          if (res.statusCode < 400) resolve({ sid: null, status: 'sent' });
          else reject(new Error(`Provider HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('SMS provider request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Dispatch a message through the configured provider.
 * @returns {Promise<{sid: string|null, status: string}>}
 */
function dispatchViaProvider({ to, body, channel }) {
  const provider = detectProvider();
  if (provider === 'twilio')  return sendViaTwilio({ to, body, channel });
  if (provider === 'generic') return sendViaGeneric({ to, body, channel });
  throw new Error('No SMS provider configured. Set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN or SMS_PROVIDER_URL.');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send an SMS (or WhatsApp) message immediately and log the result to sms_logs.
 *
 * @param {object} opts
 * @param {number} opts.organizationId
 * @param {number|null} [opts.clientId]
 * @param {string} opts.to              - E.164 phone number, e.g. +521234567890
 * @param {string} opts.body            - Message body text
 * @param {'sms'|'whatsapp'} [opts.channel='sms']
 * @param {number|null} [opts.templateId]
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendSms({ organizationId, clientId = null, to, body, channel = 'sms', templateId = null }) {
  const provider = detectProvider() || 'none';

  let status;
  let providerMessageId = null;
  let errorCode         = null;
  let errorMessage      = null;
  let sentAt            = null;

  try {
    const result = await dispatchViaProvider({ to, body, channel });
    // Twilio queues first then delivers — treat 'queued' and 'sent' as success
    status            = (result.status === 'queued' || result.status === 'sent') ? 'sent' : (result.status || 'sent');
    providerMessageId = result.sid || null;
    sentAt            = new Date();
  } catch (err) {
    status       = 'failed';
    errorCode    = err.code   || null;
    errorMessage = err.message || String(err);
    logger.warn({ err, to, channel }, 'SMS send failed');
  }

  await db.query(
    `INSERT INTO sms_logs
       (organization_id, client_id, phone_number, channel, direction, template_id,
        message_body, provider, provider_message_id, status, error_code, error_message, sent_at)
     VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      organizationId, clientId, to, channel, templateId,
      body, provider, providerMessageId,
      status, errorCode, errorMessage,
      sentAt,
    ],
  );

  if (status === 'sent') {
    return { success: true, messageId: providerMessageId };
  }
  return { success: false, error: errorMessage };
}

/**
 * Queue an SMS for later delivery by inserting a 'queued' row into sms_logs.
 * The sms_send scheduled task will pick it up and call processQueue().
 *
 * @param {object} opts - Same as sendSms()
 * @returns {Promise<{queued: true, logId: number}>}
 */
async function queueSms({ organizationId, clientId = null, to, body, channel = 'sms', templateId = null }) {
  const provider = detectProvider() || 'none';

  const [result] = await db.query(
    `INSERT INTO sms_logs
       (organization_id, client_id, phone_number, channel, direction, template_id,
        message_body, provider, status)
     VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, 'queued')`,
    [organizationId, clientId, to, channel, templateId, body, provider],
  );

  return { queued: true, logId: result.insertId };
}

/**
 * Process all SMS rows in the 'queued' state (up to 50 at a time).
 * Called by the 'sms_send' scheduled task.
 *
 * @returns {Promise<{sent: number, failed: number, total: number}>}
 */
async function processQueue() {
  const [queued] = await db.query(
    'SELECT * FROM sms_logs WHERE status = \'queued\' ORDER BY created_at ASC LIMIT 50',
  );

  let sent   = 0;
  let failed = 0;

  for (const entry of queued) {
    try {
      const result = await dispatchViaProvider({
        to:      entry.phone_number,
        body:    entry.message_body,
        channel: entry.channel,
      });

      const newStatus = (result.status === 'queued' || result.status === 'sent') ? 'sent' : (result.status || 'sent');

      await db.query(
        `UPDATE sms_logs
            SET status = ?, provider_message_id = ?, sent_at = NOW(), error_code = NULL, error_message = NULL
          WHERE id = ?`,
        [newStatus, result.sid || null, entry.id],
      );
      sent++;
    } catch (err) {
      await db.query(
        `UPDATE sms_logs
            SET status = 'failed', error_code = ?, error_message = ?
          WHERE id = ?`,
        [err.code || null, err.message || String(err), entry.id],
      );
      failed++;
      logger.warn({ err, logId: entry.id }, 'SMS queue processing: message failed');
    }
  }

  return { sent, failed, total: queued.length };
}

/**
 * Retry a single failed sms_logs row.
 *
 * @param {number} logId
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function retryLog(logId) {
  const [rows] = await db.query('SELECT * FROM sms_logs WHERE id = ?', [logId]);
  const entry  = rows[0];
  if (!entry) throw new Error(`sms_logs row ${logId} not found`);
  if (entry.status !== 'failed' && entry.status !== 'undelivered') {
    throw new Error(`sms_logs row ${logId} is not in a retryable state (status: ${entry.status})`);
  }

  try {
    const result = await dispatchViaProvider({
      to:      entry.phone_number,
      body:    entry.message_body,
      channel: entry.channel,
    });

    const newStatus = (result.status === 'queued' || result.status === 'sent') ? 'sent' : (result.status || 'sent');

    await db.query(
      `UPDATE sms_logs
          SET status = ?, provider_message_id = ?, sent_at = NOW(), error_code = NULL, error_message = NULL
        WHERE id = ?`,
      [newStatus, result.sid || null, logId],
    );

    return { success: true, messageId: result.sid || null };
  } catch (err) {
    await db.query(
      `UPDATE sms_logs
          SET status = 'failed', error_code = ?, error_message = ?
        WHERE id = ?`,
      [err.code || null, err.message || String(err), logId],
    );
    return { success: false, error: err.message };
  }
}

module.exports = { sendSms, queueSms, processQueue, retryLog, detectProvider };
