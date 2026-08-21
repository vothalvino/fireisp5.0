// =============================================================================
// FireISP 5.0 — bounded, tenant-safe SMTP delivery
// =============================================================================
// Tenant SMTP settings are untrusted egress configuration. Every tenant send
// resolves and pins a public destination, requires TLS, rechecks the peer, and
// owns the exact socket so an absolute timeout really stops delivery. The
// install-controlled relay has a separate trusted path for local relays.
// Client-directed messages also pass the authoritative DND/consent check at
// the last practical boundary before SMTP I/O.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'emailTransport' });
const { decryptStrict } = require('../utils/encryption');
const {
  sendTenantSmtp,
  sendTrustedSmtp,
  DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
  DEFAULT_SMTP_GREETING_TIMEOUT_MS,
  DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
} = require('../utils/safeSmtpSender');
const communicationPreferences = require('./clientCommunicationPreferenceService');

const DEFAULT_FUNCTION = 'general';
const SMTP_CONNECTION_TIMEOUT_MS = DEFAULT_SMTP_CONNECTION_TIMEOUT_MS;
const SMTP_GREETING_TIMEOUT_MS = DEFAULT_SMTP_GREETING_TIMEOUT_MS;
const SMTP_SOCKET_TIMEOUT_MS = DEFAULT_SMTP_SOCKET_TIMEOUT_MS;
const QUEUE_CLAIM_MESSAGE = 'Delivery claimed; awaiting provider result';
const QUEUE_OUTCOME_UNKNOWN_MESSAGE = 'Provider invocation started; delivery outcome is unknown';
const QUEUE_STALE_CLAIM_MINUTES = 5;

function withTenant(organizationId, callback) {
  return organizationId === null || organizationId === undefined
    || typeof db.withTenantContext !== 'function'
    ? callback()
    : db.withTenantContext(Number(organizationId), callback);
}

function normalizePort(value, fallback = 587) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function formatFrom(row, fallback) {
  if (!row) return fallback;
  const address = row.from_email || row.smtp_user || fallback;
  return row.from_name ? `${row.from_name} <${address}>` : address;
}

async function loadEffectiveSettings(organizationId, emailFunction) {
  const EmailSettings = require('../models/EmailSettings');
  return withTenant(organizationId, async () => {
    const requested = await EmailSettings.findRawByOrgId(organizationId, emailFunction);
    if (requested?.enabled && requested.smtp_host) return requested;
    if (emailFunction !== DEFAULT_FUNCTION) {
      const general = await EmailSettings.findRawByOrgId(organizationId, DEFAULT_FUNCTION);
      if (general?.enabled && general.smtp_host) return general;
    }
    return null;
  });
}

async function getOrgTransport(organizationId, emailFunction = DEFAULT_FUNCTION) {
  const row = await loadEffectiveSettings(organizationId, emailFunction);
  if (!row) return null;
  const password = row.smtp_password_encrypted
    ? decryptStrict(row.smtp_password_encrypted)
    : null;
  return {
    host: row.smtp_host,
    port: normalizePort(row.smtp_port, 587),
    secure: Boolean(row.smtp_secure),
    auth: row.smtp_user ? { user: row.smtp_user, pass: password || '' } : undefined,
    from: formatFrom(row, process.env.SMTP_FROM || 'noreply@fireisp.local'),
  };
}

// Preserved as a compatibility hook for EmailSettings.upsert and older test
// doubles. One-shot transports intentionally have no long-lived cache.
function invalidateOrgTransport() {}

function init() {
  // Kept for the existing boot/test API. The actual transport is deliberately
  // constructed per send so settings, DNS, TLS and revocations are fresh.
  return true;
}

function safeFailure(err, sanitizeFailure) {
  const rawCode = String(err?.code || 'EMAIL_DELIVERY_FAILED');
  const allowedCodes = new Set([
    'EMAIL_DELIVERY_TIMEOUT',
    'EMAIL_SETTINGS_CHANGED',
    'ENCRYPTION_NOT_CONFIGURED',
    'ENCRYPTED_SECRET_INVALID',
    'INVALID_SMTP_CONFIG',
    'SMTP_PEER_INVALID',
    'UNSAFE_HOST',
    'ORGANIZATION_INACTIVE',
    'CLIENT_ATTRIBUTION_REQUIRED',
  ]);
  const code = allowedCodes.has(rawCode) ? rawCode : 'EMAIL_DELIVERY_FAILED';
  if (sanitizeFailure) return { error: 'Email delivery failed.', code };
  const messages = {
    EMAIL_DELIVERY_TIMEOUT: 'Email delivery timed out.',
    ENCRYPTION_NOT_CONFIGURED: 'The saved SMTP credential is unavailable.',
    ENCRYPTED_SECRET_INVALID: 'The saved SMTP credential is unavailable.',
    INVALID_SMTP_CONFIG: 'The SMTP configuration is invalid.',
    SMTP_PEER_INVALID: 'The SMTP destination could not be verified.',
    UNSAFE_HOST: 'The SMTP destination is not permitted.',
    ORGANIZATION_INACTIVE: 'The organization is not active.',
    CLIENT_ATTRIBUTION_REQUIRED: 'Client delivery authorization is unavailable.',
  };
  return { error: messages[code] || 'Email delivery failed.', code };
}

async function writeLog(organizationId, sql, params) {
  const execute = () => db.query(sql, params);
  return withTenant(organizationId, execute);
}

async function logOutcome({
  organizationId,
  clientId,
  to,
  subject,
  status,
  error,
  messageClass,
  organizationEpoch = 0,
  clientContactEpoch = 0,
}) {
  if (status === 'sent') {
    return writeLog(
      organizationId,
      `INSERT INTO email_logs
         (recipient, subject, channel, status, sent_at, organization_id,
          organization_epoch, client_id, client_contact_epoch, message_class)
       VALUES (?, ?, 'email', 'sent', NOW(), ?, ?, ?, ?, ?)`,
      [to, subject, organizationId ?? null, organizationEpoch, clientId ?? null, clientContactEpoch, messageClass],
    );
  }
  return writeLog(
    organizationId,
    `INSERT INTO email_logs
       (recipient, subject, channel, status, error_message, organization_id,
        organization_epoch, client_id, client_contact_epoch, message_class)
     VALUES (?, ?, 'email', 'failed', ?, ?, ?, ?, ?, ?)`,
    [to, subject, error, organizationId ?? null, organizationEpoch, clientId ?? null, clientContactEpoch, messageClass],
  );
}

/** Send one email. Client messages require a server-owned messageClass. */
async function sendEmail({
  to,
  subject,
  html,
  text,
  attachments,
  organizationId = null,
  clientId = null,
  messageClass = null,
  emailFunction = DEFAULT_FUNCTION,
  absoluteTimeoutMs = null,
  installTransportOnly = false,
  operationalRecipient = false,
  sanitizeFailure = false,
  suppressLog = false,
  expectedClientContactEpoch = null,
}) {
  let failure;
  let organizationState = { active: true, epoch: 0 };
  let clientContactEpoch = 0;

  try {
    const hasClient = clientId !== null && clientId !== undefined;
    if ((hasClient && (operationalRecipient || !messageClass))
        || (!hasClient && (!operationalRecipient || messageClass))) {
      throw Object.assign(new Error('Client and operational recipient lanes must be explicit.'), {
        code: 'CLIENT_ATTRIBUTION_REQUIRED',
      });
    }
    organizationState = await communicationPreferences.getOrganizationDeliveryState(organizationId);
    if (!organizationState.active) {
      throw Object.assign(new Error('Organization is inactive.'), { code: 'ORGANIZATION_INACTIVE' });
    }

    if (hasClient) {
      const preference = await communicationPreferences.evaluateClientCommunication({
        organizationId,
        clientId,
        channel: 'email',
        destination: to,
        messageClass,
      });
      if (!preference.allowed) {
        const blocked = communicationPreferences.blockedResult(preference.code);
        if (!suppressLog) await logOutcome({
          organizationId,
          clientId,
          to,
          subject,
          status: 'failed',
          error: blocked.error,
          messageClass,
          organizationEpoch: organizationState.epoch || 0,
        });
        return blocked;
      }
      clientContactEpoch = Number(preference.contactEpoch || 0);
      if (expectedClientContactEpoch !== null
          && Number(expectedClientContactEpoch) !== clientContactEpoch) {
        const blocked = communicationPreferences.blockedResult(
          communicationPreferences.BLOCK_CODES.CONTACT_MISMATCH,
        );
        return blocked;
      }
    }

    const fallbackFrom = process.env.SMTP_FROM || 'noreply@fireisp.local';
    const tenant = organizationId && !installTransportOnly
      ? await getOrgTransport(organizationId, emailFunction)
      : null;
    const message = {
      from: tenant?.from || fallbackFrom,
      to,
      subject,
      html,
      text,
      attachments,
    };
    const finalOrganizationState = await communicationPreferences.getOrganizationDeliveryState(organizationId);
    if (!finalOrganizationState.active
        || Number(finalOrganizationState.epoch) !== Number(organizationState.epoch)) {
      throw Object.assign(new Error('Organization delivery state changed.'), {
        code: 'ORGANIZATION_INACTIVE',
      });
    }
    if (hasClient) {
      const finalPreference = await communicationPreferences.evaluateClientCommunication({
        organizationId,
        clientId,
        channel: 'email',
        destination: to,
        messageClass,
      });
      const finalEpoch = Number(finalPreference.contactEpoch || 0);
      if (!finalPreference.allowed
          || finalEpoch !== clientContactEpoch
          || (expectedClientContactEpoch !== null
            && Number(expectedClientContactEpoch) !== finalEpoch)) {
        const code = finalPreference.allowed
          ? communicationPreferences.BLOCK_CODES.CONTACT_MISMATCH
          : finalPreference.code;
        const blocked = communicationPreferences.blockedResult(code);
        if (!suppressLog) await logOutcome({
          organizationId,
          clientId,
          to,
          subject,
          status: 'failed',
          error: blocked.error,
          messageClass,
          organizationEpoch: organizationState.epoch || 0,
          clientContactEpoch,
        });
        return blocked;
      }
    }
    const info = tenant
      ? await sendTenantSmtp({
        ...tenant,
        message,
        absoluteTimeoutMs,
      })
      : await sendTrustedSmtp({
        host: process.env.SMTP_HOST || 'localhost',
        port: normalizePort(process.env.SMTP_PORT, 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
          : undefined,
        requireTls: process.env.SMTP_REQUIRE_TLS === 'true'
          || Boolean(process.env.SMTP_USER),
        message,
        absoluteTimeoutMs,
      });

    if (!suppressLog) await logOutcome({
      organizationId,
      clientId,
      to,
      subject,
      status: 'sent',
      messageClass,
      organizationEpoch: organizationState.epoch || 0,
      clientContactEpoch,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    failure = safeFailure(err, sanitizeFailure);
    logger.warn({ code: failure.code }, 'Email delivery failed');
    if (!suppressLog) await logOutcome({
      organizationId,
      clientId,
      to,
      subject,
      status: 'failed',
      error: failure.error,
      messageClass,
      organizationEpoch: organizationState.epoch || 0,
      clientContactEpoch,
    });
    return { success: false, ...failure };
  }
}

async function recoverStaleQueueClaims(scope, params) {
  await db.query(
    `UPDATE email_logs
        SET status = 'queued', error_message = NULL, sent_at = NULL
      WHERE status = 'failed' AND error_message = ?
        AND sent_at < DATE_SUB(NOW(), INTERVAL ${QUEUE_STALE_CLAIM_MINUTES} MINUTE)${scope}`,
    [QUEUE_CLAIM_MESSAGE, ...params],
  );
}

async function claimAndDeliverQueuedEmail(entry) {
  const [claim] = await db.query(
    `UPDATE email_logs
        SET status = 'failed', error_message = ?, sent_at = NOW()
      WHERE id = ? AND organization_id <=> ? AND status = 'queued'`,
    [QUEUE_CLAIM_MESSAGE, entry.id, entry.organization_id],
  );
  if (claim.affectedRows !== 1) return { claimed: false, success: false };

  const finish = async (success, error = null, guard = QUEUE_CLAIM_MESSAGE) => {
    const [outcome] = await db.query(
      `UPDATE email_logs
          SET status = ?, sent_at = IF(? = 'sent', NOW(), NULL), error_message = ?
        WHERE id = ? AND organization_id <=> ?
          AND status = 'failed' AND error_message = ?`,
      [
        success ? 'sent' : 'failed',
        success ? 'sent' : 'failed',
        success ? null : (error || 'Email delivery failed.'),
        entry.id,
        entry.organization_id,
        guard,
      ],
    );
    return { claimed: true, success: success && outcome.affectedRows === 1 };
  };

  const owner = await communicationPreferences.getOrganizationDeliveryState(entry.organization_id);
  if (!owner.active || Number(owner.epoch) !== Number(entry.organization_epoch || 0)) {
    return finish(false, 'Organization delivery authorization changed; message skipped.');
  }
  if (entry.client_id === null || entry.client_id === undefined || !entry.message_class) {
    return finish(false, 'Client delivery authorization is unavailable; message skipped.');
  }

  const preference = await communicationPreferences.evaluateClientCommunication({
    organizationId: entry.organization_id,
    clientId: entry.client_id,
    channel: 'email',
    destination: entry.recipient,
    messageClass: entry.message_class,
  });
  if (!preference.allowed
      || Number(preference.contactEpoch || 0) !== Number(entry.client_contact_epoch || 0)) {
    return finish(false, 'Client communication preference blocks this delivery.');
  }

  const [invocation] = await db.query(
    `UPDATE email_logs SET error_message = ?, sent_at = NOW()
      WHERE id = ? AND organization_id <=> ?
        AND status = 'failed' AND error_message = ?`,
    [QUEUE_OUTCOME_UNKNOWN_MESSAGE, entry.id, entry.organization_id, QUEUE_CLAIM_MESSAGE],
  );
  if (invocation.affectedRows !== 1) return { claimed: false, success: false };

  const result = await sendEmail({
    organizationId: entry.organization_id,
    clientId: entry.client_id,
    messageClass: entry.message_class,
    expectedClientContactEpoch: Number(entry.client_contact_epoch || 0),
    to: entry.recipient,
    subject: entry.subject,
    html: entry.body || undefined,
    text: entry.body || undefined,
    suppressLog: true,
  });
  if (result.success) {
    return finish(true, null, QUEUE_OUTCOME_UNKNOWN_MESSAGE);
  }
  // A preference/lifecycle skip proves sendEmail returned before SMTP I/O and
  // may be recorded as an ordinary terminal failure. Any other failure after
  // the invocation marker is ambiguous (the relay may have accepted the
  // message even if its acknowledgement was lost), so retain the durable
  // outcome-unknown marker and never make it automatically retryable.
  if (result.skipped) {
    return finish(false, result.error || null, QUEUE_OUTCOME_UNKNOWN_MESSAGE);
  }
  return {
    claimed: true,
    success: false,
    code: 'EMAIL_DELIVERY_OUTCOME_UNKNOWN',
    error: 'Email provider outcome is unknown; manual reconciliation is required.',
  };
}

/**
 * Drain rows queued by notificationService. Each row retains organization,
 * client and marketing-class state, and sendEmail repeats all live checks.
 */
async function processCurrentQueue({ organizationId = null, excludeOrganizationIds = [] } = {}) {
  const excluded = [...new Set(excludeOrganizationIds.map(Number).filter(Number.isSafeInteger))];
  const params = [];
  let scope = '';
  if (organizationId !== null && organizationId !== undefined) {
    scope = ' AND organization_id = ?';
    params.push(Number(organizationId));
  } else if (excluded.length) {
    scope = ` AND (organization_id IS NULL OR organization_id NOT IN (${excluded.map(() => '?').join(',')}))`;
    params.push(...excluded);
  }
  await recoverStaleQueueClaims(scope, params);
  const [queued] = await db.query(
    `SELECT * FROM email_logs
      WHERE status = 'queued'${scope}
      ORDER BY created_at ASC LIMIT 50`,
    params,
  );
  let sent = 0;
  let failed = 0;
  for (const entry of queued) {
    try {
      const result = await claimAndDeliverQueuedEmail(entry);
      if (!result.claimed) continue;
      if (result.success) sent++; else failed++;
    } catch (err) {
      logger.warn({ code: err?.code || 'EMAIL_QUEUE_FAILED', logId: entry.id }, 'Email queue processing failed');
    }
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

module.exports = {
  init,
  sendEmail,
  processQueue,
  getOrgTransport,
  invalidateOrgTransport,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
};
