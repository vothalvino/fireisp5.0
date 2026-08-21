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
const communicationPreferences = require('./clientCommunicationPreferenceService');

const DELIVERY_CLAIM_CODE = 'DELIVERY_CLAIMED';
const DELIVERY_CLAIM_MESSAGE = 'Delivery claimed; awaiting provider result';
const DELIVERY_OUTCOME_UNKNOWN_CODE = 'DELIVERY_OUTCOME_UNKNOWN';
const DELIVERY_OUTCOME_UNKNOWN_MESSAGE = 'Provider invocation started; delivery outcome is unknown';
const STALE_CLAIM_MINUTES = 5;

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

// Provider vocabularies are broader than sms_logs.status (Twilio may return
// accepted/scheduled/sending and generic gateways may return arbitrary text).
// A successful HTTP/provider call means the platform accepted the message;
// only an explicit delivered result advances the stronger local state.
function normalizeAcceptedStatus(status) {
  return status === 'delivered' ? 'delivered' : 'sent';
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
async function sendSmsCurrent({
  organizationId,
  clientId = null,
  to,
  body,
  channel = 'sms',
  templateId = null,
  messageClass = null,
  expectedClientContactEpoch = null,
}) {
  const provider = detectProvider() || 'none';
  const organizationState = await communicationPreferences.getOrganizationDeliveryState(organizationId);

  let status;
  let providerMessageId = null;
  let errorCode         = null;
  let errorMessage      = null;
  let sentAt            = null;
  let clientContactEpoch = 0;

  try {
    if (!organizationState.active) {
      throw Object.assign(new Error('Organization is inactive.'), { code: 'ORGANIZATION_INACTIVE' });
    }
    if (clientId !== null && clientId !== undefined) {
      const preference = await communicationPreferences.evaluateClientCommunication({
        organizationId,
        clientId,
        channel,
        destination: to,
        messageClass,
      });
      if (!preference.allowed) {
        status = 'failed';
        errorCode = preference.code;
        errorMessage = 'Client communication preference blocks this delivery.';
      } else {
        clientContactEpoch = Number(preference.contactEpoch || 0);
        if (expectedClientContactEpoch !== null
            && Number(expectedClientContactEpoch) !== clientContactEpoch) {
          status = 'failed';
          errorCode = communicationPreferences.BLOCK_CODES.CONTACT_MISMATCH;
          errorMessage = 'Client contact authorization changed; message skipped.';
        }
      }
    }

    const finalOrganizationState = await communicationPreferences.getOrganizationDeliveryState(organizationId);
    if (status !== 'failed' && (!finalOrganizationState.active
        || Number(finalOrganizationState.epoch) !== Number(organizationState.epoch))) {
      throw Object.assign(new Error('Organization delivery state changed.'), {
        code: 'ORGANIZATION_INACTIVE',
      });
    }
    if (status !== 'failed' && clientId !== null && clientId !== undefined) {
      const finalPreference = await communicationPreferences.evaluateClientCommunication({
        organizationId,
        clientId,
        channel,
        destination: to,
        messageClass,
      });
      const finalEpoch = Number(finalPreference.contactEpoch || 0);
      if (!finalPreference.allowed || finalEpoch !== clientContactEpoch
          || (expectedClientContactEpoch !== null
            && Number(expectedClientContactEpoch) !== finalEpoch)) {
        status = 'failed';
        errorCode = finalPreference.allowed
          ? communicationPreferences.BLOCK_CODES.CONTACT_MISMATCH
          : finalPreference.code;
        errorMessage = 'Client communication preference blocks this delivery.';
      }
    }
    const result = status === 'failed' ? null : await dispatchViaProvider({ to, body, channel });
    if (!result) throw Object.assign(new Error(errorMessage), { code: errorCode, preferenceBlocked: true });
    // Twilio queues first then delivers — treat 'queued' and 'sent' as success
    status            = normalizeAcceptedStatus(result.status);
    providerMessageId = result.sid || null;
    sentAt            = new Date();
  } catch (err) {
    status       = 'failed';
    errorCode    = err.code   || null;
    errorMessage = err.message || String(err);
    if (!err.preferenceBlocked) logger.warn({ err, to, channel }, 'SMS send failed');
  }

  await db.query(
    `INSERT INTO sms_logs
       (organization_id, organization_epoch, client_id, client_contact_epoch, phone_number, channel, direction, template_id,
        message_body, provider, provider_message_id, status, error_code, error_message,
        message_class, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      organizationId, organizationState.epoch || 0, clientId, clientContactEpoch, to, channel, templateId,
      body, provider, providerMessageId,
      status, errorCode, errorMessage,
      messageClass,
      sentAt,
    ],
  );

  if (status === 'sent' || status === 'delivered') {
    return { success: true, messageId: providerMessageId };
  }
  const preferenceSkipped = Object.values(communicationPreferences.BLOCK_CODES).includes(errorCode);
  return {
    success: false,
    error: errorMessage,
    ...(errorCode && { code: errorCode }),
    ...(preferenceSkipped && { skipped: true }),
  };
}

/**
 * Queue an SMS for later delivery by inserting a 'queued' row into sms_logs.
 * When REDIS_URL is set the job is also enqueued via BullMQ for immediate
 * processing rather than waiting for the next cron tick.
 * The sms_send scheduled task / BullMQ worker will claim the durable row to send.
 *
 * @param {object} opts - Same as sendSms()
 * @returns {Promise<{queued: true, logId: number}>}
 */
async function queueSmsCurrent({
  organizationId,
  clientId = null,
  to,
  body,
  channel = 'sms',
  templateId = null,
  messageClass = null,
}) {
  const provider = detectProvider() || 'none';
  const organizationState = await communicationPreferences.getOrganizationDeliveryState(organizationId);
  let clientContactEpoch = 0;

  if (!organizationState.active) {
    return { queued: false, skipped: true, code: 'ORGANIZATION_INACTIVE' };
  }

  if (clientId !== null && clientId !== undefined) {
    const preference = await communicationPreferences.evaluateClientCommunication({
      organizationId,
      clientId,
      channel,
      destination: to,
      messageClass,
    });
    if (!preference.allowed) {
      const [blocked] = await db.query(
        `INSERT INTO sms_logs
           (organization_id, organization_epoch, client_id, client_contact_epoch, phone_number, channel, direction, template_id,
            message_body, provider, status, error_code, error_message, message_class)
         VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?, 'failed', ?, ?, ?)`,
        [
          organizationId, organizationState.epoch || 0, clientId, 0, to, channel, templateId, body, provider,
          preference.code, 'Client communication preference blocks this delivery.',
          messageClass,
        ],
      );
      return { queued: false, skipped: true, logId: blocked.insertId, code: preference.code };
    }
    clientContactEpoch = Number(preference.contactEpoch || 0);
  }

  const [result] = await db.query(
    `INSERT INTO sms_logs
       (organization_id, organization_epoch, client_id, client_contact_epoch, phone_number, channel, direction, template_id,
        message_body, provider, status, message_class)
     VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?, 'queued', ?)`,
    [organizationId, organizationState.epoch || 0, clientId, clientContactEpoch, to, channel, templateId, body, provider, messageClass],
  );

  const logId = result.insertId;

  // When BullMQ is available dispatch immediately — otherwise the cron task picks it up
  if (process.env.REDIS_URL) {
    const jobQueue = require('./jobQueueService');
    await jobQueue.add('sms-send', { logId, organizationId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    }).catch(() => {}); // Non-critical: cron fallback will pick it up
  }

  return { queued: true, logId };
}

/**
 * Claim one durable outbound row before any provider I/O. `sms_send` can be
 * reached by BullMQ, the scheduled sweep, and an explicit retry; the compare-
 * and-set below is the single boundary that prevents those paths from sending
 * the same row concurrently. A stale claim is recovered by the sweep after a
 * bounded interval, giving the queue conventional at-least-once crash
 * semantics without holding a database lock across the network request.
 */
async function claimAndDeliver(entry, claimableStatuses) {
  const statuses = [...new Set(claimableStatuses)].filter(status => (
    ['queued', 'failed', 'undelivered'].includes(status)
  ));
  if (!entry || statuses.length === 0) return { claimed: false, success: false };

  const [claim] = await db.query(
    `UPDATE sms_logs
        SET status = 'failed', error_code = ?, error_message = ?, sent_at = NOW()
      WHERE id = ? AND organization_id <=> ? AND direction = 'outbound'
        AND status IN (${statuses.map(() => '?').join(',')})
        AND COALESCE(error_code, '') NOT IN (?, ?)`,
    [
      DELIVERY_CLAIM_CODE,
      DELIVERY_CLAIM_MESSAGE,
      entry.id,
      entry.organization_id,
      ...statuses,
      DELIVERY_CLAIM_CODE,
      DELIVERY_OUTCOME_UNKNOWN_CODE,
    ],
  );
  if (claim.affectedRows !== 1) return { claimed: false, success: false };

  let outcomeGuard = DELIVERY_CLAIM_CODE;

  const finish = async ({ success, result = null, code = null, error = null }) => {
    const status = success ? normalizeAcceptedStatus(result.status) : 'failed';
    const [outcome] = await db.query(
      `UPDATE sms_logs
          SET status = ?, provider_message_id = ?,
              sent_at = IF(? IN ('sent','delivered'), NOW(), NULL),
              error_code = ?, error_message = ?
        WHERE id = ? AND organization_id <=> ?
          AND status = 'failed' AND error_code = ?`,
      [
        status,
        success ? (result.sid || null) : null,
        status,
        success ? null : code,
        success ? null : error,
        entry.id,
        entry.organization_id,
        outcomeGuard,
      ],
    );
    return {
      claimed: true,
      success: success && outcome.affectedRows === 1,
      messageId: success ? (result.sid || null) : undefined,
      code: success ? undefined : code,
      error: success ? undefined : error,
    };
  };

  try {
    const owner = await communicationPreferences.getOrganizationDeliveryState(entry.organization_id);
    if (!owner.active || Number(owner.epoch) !== Number(entry.organization_epoch || 0)) {
      return finish({
        success: false,
        code: communicationPreferences.BLOCK_CODES.ORGANIZATION_INACTIVE,
        error: 'Organization delivery authorization changed; message skipped.',
      });
    }
    if (entry.client_id === null || entry.client_id === undefined || !entry.message_class) {
      return finish({
        success: false,
        code: communicationPreferences.BLOCK_CODES.CLIENT_NOT_FOUND,
        error: 'Client delivery authorization is unavailable; message skipped.',
      });
    }

    const preference = await communicationPreferences.evaluateClientCommunication({
      organizationId: entry.organization_id,
      clientId: entry.client_id,
      channel: entry.channel,
      destination: entry.phone_number,
      messageClass: entry.message_class,
    });
    if (!preference.allowed) {
      return finish({
        success: false,
        code: preference.code,
        error: 'Client communication preference blocks this delivery.',
      });
    }
    if (Number(preference.contactEpoch || 0) !== Number(entry.client_contact_epoch || 0)) {
      return finish({
        success: false,
        code: communicationPreferences.BLOCK_CODES.CONTACT_MISMATCH,
        error: 'Client contact authorization changed; message skipped.',
      });
    }

    // Repeat both lifecycle and preference checks after owning the durable
    // claim and immediately before provider I/O.
    const finalOwner = await communicationPreferences.getOrganizationDeliveryState(entry.organization_id);
    const finalPreference = await communicationPreferences.evaluateClientCommunication({
      organizationId: entry.organization_id,
      clientId: entry.client_id,
      channel: entry.channel,
      destination: entry.phone_number,
      messageClass: entry.message_class,
    });
    if (!finalOwner.active
        || Number(finalOwner.epoch) !== Number(entry.organization_epoch || 0)) {
      return finish({
        success: false,
        code: communicationPreferences.BLOCK_CODES.ORGANIZATION_INACTIVE,
        error: 'Organization delivery authorization changed; message skipped.',
      });
    }
    if (!finalPreference.allowed
        || Number(finalPreference.contactEpoch || 0) !== Number(entry.client_contact_epoch || 0)) {
      return finish({
        success: false,
        code: finalPreference.allowed
          ? communicationPreferences.BLOCK_CODES.CONTACT_MISMATCH
          : finalPreference.code,
        error: 'Client communication preference blocks this delivery.',
      });
    }


    // Once this CAS commits, a crash is ambiguous: the provider invocation
    // may have accepted the message even if no outcome was recorded. Such a
    // row is deliberately NOT auto-reclaimed; an operator must reconcile it.
    // Only DELIVERY_CLAIMED (which proves provider I/O has not begun) is safe
    // for the scheduled stale-claim recovery below.
    const [invocation] = await db.query(
      `UPDATE sms_logs
          SET error_code = ?, error_message = ?, sent_at = NOW()
        WHERE id = ? AND organization_id <=> ?
          AND status = 'failed' AND error_code = ?`,
      [
        DELIVERY_OUTCOME_UNKNOWN_CODE,
        DELIVERY_OUTCOME_UNKNOWN_MESSAGE,
        entry.id,
        entry.organization_id,
        DELIVERY_CLAIM_CODE,
      ],
    );
    if (invocation.affectedRows !== 1) return { claimed: false, success: false };
    outcomeGuard = DELIVERY_OUTCOME_UNKNOWN_CODE;

    const result = await dispatchViaProvider({
      to: entry.phone_number,
      body: entry.message_body,
      channel: entry.channel,
    });
    return await finish({ success: true, result });
  } catch (err) {
    logger.warn({ code: err?.code || 'SMS_DELIVERY_FAILED', logId: entry.id }, 'SMS queue delivery failed');
    if (outcomeGuard === DELIVERY_OUTCOME_UNKNOWN_CODE) {
      return {
        claimed: true,
        success: false,
        code: DELIVERY_OUTCOME_UNKNOWN_CODE,
        error: DELIVERY_OUTCOME_UNKNOWN_MESSAGE,
      };
    }
    return finish({
      success: false,
      code: err?.code || null,
      error: err?.message || 'SMS delivery failed.',
    });
  }
}

async function recoverStaleClaims(scope, params) {
  await db.query(
    `UPDATE sms_logs
        SET status = 'queued', error_code = NULL, error_message = NULL, sent_at = NULL
      WHERE status = 'failed' AND error_code = ?
        AND sent_at < DATE_SUB(NOW(), INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)${scope}`,
    [DELIVERY_CLAIM_CODE, ...params],
  );
}

/**
 * Process all SMS rows in the 'queued' state (up to 50 at a time).
 * Called by the 'sms_send' scheduled task.
 *
 * @returns {Promise<{sent: number, failed: number, total: number}>}
 */
async function processCurrentQueue({ organizationId = null, excludeOrganizationIds = [] } = {}) {
  const excluded = [...new Set(excludeOrganizationIds.map(Number).filter(Number.isSafeInteger))];
  const params = [];
  let scope = '';
  if (organizationId !== null && organizationId !== undefined) {
    scope = ' AND organization_id = ?';
    params.push(Number(organizationId));
  } else if (excluded.length) {
    scope = ` AND organization_id NOT IN (${excluded.map(() => '?').join(',')})`;
    params.push(...excluded);
  }
  await recoverStaleClaims(scope, params);
  const [queued] = await db.query(
    `SELECT * FROM sms_logs WHERE status = 'queued'${scope} ORDER BY created_at ASC LIMIT 50`,
    params,
  );

  let sent   = 0;
  let failed = 0;

  for (const entry of queued) {
    const result = await claimAndDeliver(entry, ['queued']);
    if (!result.claimed) continue;
    if (result.success) sent++; else failed++;
  }

  return { sent, failed, total: queued.length };
}

function mergeQueueResults(target, result) {
  target.sent += Number(result.sent || 0);
  target.failed += Number(result.failed || 0);
  target.total += Number(result.total || 0);
}

async function processQueue(organizationId = null) {
  if (organizationId !== null && organizationId !== undefined) {
    const run = () => processCurrentQueue({ organizationId: Number(organizationId) });
    return typeof db.withTenantContext === 'function'
      ? db.withTenantContext(Number(organizationId), run)
      : run();
  }
  if (typeof db.withPrimaryContext !== 'function' || typeof db.withTenantContext !== 'function') {
    return processCurrentQueue();
  }
  const [isolated] = await db.withPrimaryContext(() => db.query(
    `SELECT organization_id FROM organization_database_configs
      WHERE isolation_mode = 'isolated' ORDER BY organization_id`,
  ));
  const isolatedIds = isolated.map(row => Number(row.organization_id)).filter(Number.isSafeInteger);
  const total = { sent: 0, failed: 0, total: 0 };
  mergeQueueResults(total, await db.withPrimaryContext(
    () => processCurrentQueue({ excludeOrganizationIds: isolatedIds }),
  ));
  for (const row of isolated) {
    try {
      mergeQueueResults(total, await db.withTenantContext(
        Number(row.organization_id),
        () => processCurrentQueue({ organizationId: Number(row.organization_id) }),
      ));
    } catch (_err) {
      total.failed++;
    }
  }
  return total;
}

/**
 * Retry a single failed sms_logs row.
 *
 * @param {number} logId
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function loadScopedLog(logId, organizationId) {
  if (!Number.isSafeInteger(Number(organizationId)) || Number(organizationId) <= 0) {
    throw new Error('organizationId is required to deliver an SMS queue row');
  }
  const [rows] = await db.query(
    'SELECT * FROM sms_logs WHERE id = ? AND organization_id = ? LIMIT 1',
    [logId, Number(organizationId)],
  );
  const entry = rows[0];
  if (!entry) throw new Error(`sms_logs row ${logId} not found`);
  return entry;
}

async function deliverQueuedLog(logId, organizationId) {
  return withOrganization(organizationId, async () => {
    const entry = await loadScopedLog(logId, organizationId);
    if (entry.status !== 'queued') {
      return { success: false, skipped: true, code: 'SMS_NOT_QUEUED' };
    }
    return claimAndDeliver(entry, ['queued']);
  });
}

async function retryLog(logId, organizationId = null) {
  return withOrganization(organizationId, async () => {
    const entry = await loadScopedLog(logId, organizationId);
    if (!['failed', 'undelivered'].includes(entry.status)
        || [DELIVERY_CLAIM_CODE, DELIVERY_OUTCOME_UNKNOWN_CODE].includes(entry.error_code)) {
      throw new Error(`sms_logs row ${logId} is not in a retryable state (status: ${entry.status})`);
    }
    const result = await claimAndDeliver(entry, ['failed', 'undelivered']);
    if (!result.claimed) {
      return { success: false, skipped: true, code: 'SMS_ALREADY_CLAIMED' };
    }
    return result;
  });
}

function withOrganization(organizationId, callback) {
  return organizationId === null || organizationId === undefined
    || typeof db.withTenantContext !== 'function'
    ? callback()
    : db.withTenantContext(Number(organizationId), callback);
}

function assertClientSmsAttribution(options) {
  const organizationId = Number(options?.organizationId);
  const clientId = Number(options?.clientId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
      || !Number.isSafeInteger(clientId) || clientId <= 0
      || !options?.messageClass) {
    throw Object.assign(new Error('SMS/WhatsApp client attribution and messageClass are required.'), {
      code: 'CLIENT_ATTRIBUTION_REQUIRED',
    });
  }
  communicationPreferences.assertMessageClass(options.messageClass);
}

async function sendSms(options) {
  assertClientSmsAttribution(options);
  return withOrganization(options?.organizationId, () => sendSmsCurrent(options || {}));
}

async function queueSms(options) {
  assertClientSmsAttribution(options);
  return withOrganization(options?.organizationId, () => queueSmsCurrent(options || {}));
}

module.exports = {
  sendSms,
  queueSms,
  processQueue,
  deliverQueuedLog,
  retryLog,
  detectProvider,
};
