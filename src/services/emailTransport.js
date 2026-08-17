// =============================================================================
// FireISP 5.0 — Email Transport Service
// =============================================================================
// Sends queued emails via SMTP using Nodemailer.
//
// Org-aware (migration 386): sendEmail({ organizationId, ... }) loads and
// caches the calling organization's configured SMTP transport
// (organization_email_settings, src/models/EmailSettings.js), falling back
// to the single global env-configured transport when the org has no
// enabled config. This activates per-org routing for every caller that
// already passes organizationId (invoices, payments, notificationHooks,
// paymentReminderService, scheduledReportService, taskRunner, bulk.js) with
// zero changes at those call sites — organizationId was silently ignored
// before this migration.
//
// Per-function (migration 407): sendEmail({ emailFunction, ... }) picks the
// org's identity for that function ('general' | 'support' | 'billing' |
// 'noc'). Resolution falls back requested-function -> org 'general' -> global
// env transport, so a function left unconfigured transparently inherits
// general/global. emailFunction defaults to 'general', so existing callers
// keep their exact behavior.
// =============================================================================

const nodemailer = require('nodemailer');
const crypto = require('crypto');
const db = require('../config/database');
const { decrypt } = require('../utils/encryption');

let transporter = null;

// "orgId:function" (String) -> { fingerprint, value }, where value is
// { transporter, from } or null (use global). The settings row itself is never
// positively cached: every send re-reads its authoritative database, then
// reuses an SMTP transport only when the full configuration fingerprint still
// matches. This makes a disable/rotation performed on another application
// replica effective on this process's very next send.
const orgTransportCache = new Map();

// Per-org generation counter, bumped by invalidateOrgTransport. A getOrgTransport
// call captures the generation before its DB read and refuses to cache the
// result if an invalidation raced in between — otherwise a save concurrent
// with an in-flight resolve could re-populate the cache with a stale transport
// that then persists until the NEXT save.
const orgCacheGen = new Map();

const DEFAULT_FUNCTION = 'general';
// Every SMTP transport must settle before the five-minute trap-delivery claim
// lease. These Nodemailer bounds cover connect, greeting and socket inactivity;
// the trap worker additionally applies an absolute logical deadline.
const SMTP_CONNECTION_TIMEOUT_MS = 30000;
const SMTP_GREETING_TIMEOUT_MS = 30000;
const SMTP_SOCKET_TIMEOUT_MS = 60000;

function smtpTimeoutOptions() {
  return {
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  };
}

function cacheKey(orgId, emailFunction) {
  return `${orgId}:${emailFunction}`;
}

function closeTransport(entry) {
  const candidate = entry?.value?.transporter;
  if (!candidate || typeof candidate.close !== 'function') return;
  try { candidate.close(); } catch (_) { /* already closed */ }
}

function settingsFingerprint(emailFunction, row) {
  return crypto.createHash('sha256').update(JSON.stringify([
    emailFunction,
    Boolean(row?.enabled),
    row?.smtp_host || null,
    Number(row?.smtp_port || 587),
    Boolean(row?.smtp_secure),
    row?.smtp_user || null,
    row?.smtp_password_encrypted || null,
    row?.from_email || null,
    row?.from_name || null,
  ])).digest('hex');
}

async function loadEffectiveSettings(organizationId, emailFunction) {
  // Lazy require avoids the EmailSettings.upsert() -> invalidate cache cycle.
  const EmailSettings = require('../models/EmailSettings');
  const requested = await EmailSettings.findRawByOrgId(organizationId, emailFunction);
  if (requested?.enabled && requested.smtp_host) {
    return { sourceFunction: emailFunction, row: requested };
  }
  if (emailFunction !== DEFAULT_FUNCTION) {
    const general = await EmailSettings.findRawByOrgId(organizationId, DEFAULT_FUNCTION);
    if (general?.enabled && general.smtp_host) {
      return { sourceFunction: DEFAULT_FUNCTION, row: general };
    }
  }
  return { sourceFunction: emailFunction, row: null };
}

/**
 * Initialize the global transport (called once at boot / on first send).
 */
function init() {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    } : undefined,
    ...smtpTimeoutOptions(),
  });
}

/**
 * Resolve (and cache) the SMTP transport for one org + function. Returns null
 * when neither the requested function NOR the org's 'general' identity is
 * enabled/configured — the caller then falls back to the global transport.
 * Fallback order: requested function -> org 'general' -> null (global).
 */
async function getOrgTransport(organizationId, emailFunction = DEFAULT_FUNCTION) {
  const key = cacheKey(organizationId, emailFunction);
  for (let attempt = 0; attempt < 3; attempt++) {
    const genAtStart = orgCacheGen.get(organizationId) || 0;
    const effective = await loadEffectiveSettings(organizationId, emailFunction);
    if ((orgCacheGen.get(organizationId) || 0) !== genAtStart) continue;

    const fingerprint = settingsFingerprint(effective.sourceFunction, effective.row);
    const cached = orgTransportCache.get(key);
    if (cached?.fingerprint === fingerprint) return cached.value;

    let value = null;
    const row = effective.row;
    if (row) {
      const orgTransporter = nodemailer.createTransport({
        host: row.smtp_host,
        port: row.smtp_port || 587,
        secure: Boolean(row.smtp_secure),
        auth: row.smtp_user ? {
          user: row.smtp_user,
          pass: decrypt(row.smtp_password_encrypted),
        } : undefined,
        ...smtpTimeoutOptions(),
      });
      const from = row.from_name
        ? `${row.from_name} <${row.from_email || row.smtp_user}>`
        : (row.from_email || row.smtp_user);
      value = { transporter: orgTransporter, from };
    }

    // A local save may have completed while Nodemailer was being constructed.
    // Never publish or use that stale transport for the current delivery.
    if ((orgCacheGen.get(organizationId) || 0) !== genAtStart) {
      closeTransport({ value });
      continue;
    }
    if (cached) closeTransport(cached);
    orgTransportCache.set(key, { fingerprint, value });
    return value;
  }
  const err = new Error('Organization email settings changed during resolution.');
  err.code = 'EMAIL_SETTINGS_CHANGED';
  throw err;
}

/**
 * Drop every cached function transport for an org so the next send re-reads
 * organization_email_settings. Called by EmailSettings.upsert() after every
 * save so a change takes effect on the very next send, not after a TTL. All
 * functions are cleared because a change to 'general' also changes the
 * resolved value of any function that inherits it.
 */
function invalidateOrgTransport(organizationId) {
  // Bump the generation first so any in-flight getOrgTransport resolve won't
  // re-cache a now-stale value (see cacheIfCurrent).
  orgCacheGen.set(organizationId, (orgCacheGen.get(organizationId) || 0) + 1);
  const prefix = `${organizationId}:`;
  const closed = new Set();
  for (const key of orgTransportCache.keys()) {
    if (!key.startsWith(prefix)) continue;
    const entry = orgTransportCache.get(key);
    const candidate = entry?.value?.transporter;
    if (candidate && !closed.has(candidate)) {
      closeTransport(entry);
      closed.add(candidate);
    }
    orgTransportCache.delete(key);
  }
}

/**
 * Send a single email and log it to email_logs.
 */
async function sendEmail({
  to,
  subject,
  html,
  text,
  attachments,
  organizationId,
  clientId,
  emailFunction = DEFAULT_FUNCTION,
  absoluteTimeoutMs = null,
  installTransportOnly = false,
  sanitizeFailure = false,
}) {
  let activeTransporter = transporter;
  let from = process.env.SMTP_FROM || 'noreply@fireisp.local';

  if (organizationId && !installTransportOnly) {
    const org = await getOrgTransport(organizationId, emailFunction);
    if (org) {
      activeTransporter = org.transporter;
      from = org.from || from;
    }
  }

  if (!activeTransporter) {
    if (!transporter) init();
    activeTransporter = transporter;
  }

  try {
    const sendPromise = activeTransporter.sendMail({ from, to, subject, html, text, attachments });
    let timer = null;
    const info = absoluteTimeoutMs
      ? await Promise.race([
        sendPromise,
        new Promise((_, reject) => {
          const timeout = Math.max(1000, Math.min(120000, Number(absoluteTimeoutMs) || 60000));
          timer = setTimeout(() => {
            const err = Object.assign(new Error('Email delivery exceeded its absolute deadline.'), {
              code: 'EMAIL_DELIVERY_TIMEOUT',
            });
            // Nodemailer's promise is not cancellable. Closing its transport is
            // the supported way to destroy live SMTP sockets so a timed-out
            // trap worker never leaves an orphan that can send after its claim
            // lease has been released.
            if (organizationId && !installTransportOnly) {
              // Invalidation closes the cached organization transport exactly
              // once and prevents it from being reused after this timeout.
              invalidateOrgTransport(organizationId);
            } else {
              try { activeTransporter.close(); } catch (_) { /* already closed */ }
              if (activeTransporter === transporter) transporter = null;
            }
            reject(err);
          }, timeout);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      })
      : await sendPromise;

    await db.query(
      `INSERT INTO email_logs (recipient, subject, channel, status, sent_at, organization_id, client_id)
       VALUES (?, ?, 'email', 'sent', NOW(), ?, ?)`,
      [to, subject, organizationId || null, clientId || null],
    );

    return { success: true, messageId: info.messageId };
  } catch (err) {
    const safeError = sanitizeFailure
      ? 'Email delivery failed.'
      : String(err?.message || 'Email delivery failed.');
    await db.query(
      `INSERT INTO email_logs (recipient, subject, channel, status, error_message, organization_id, client_id)
       VALUES (?, ?, 'email', 'failed', ?, ?, ?)`,
      [to, subject, safeError, organizationId || null, clientId || null],
    );

    const rawCode = String(err?.code || '');
    const code = sanitizeFailure
      ? (rawCode === 'EMAIL_DELIVERY_TIMEOUT' ? rawCode : undefined)
      : (/^[A-Z0-9_]{2,40}$/.test(rawCode) ? rawCode : undefined);
    return { success: false, error: safeError, ...(code && { code }) };
  }
}

/**
 * Process all queued emails (status = 'queued' in email_logs).
 *
 * Deliberately NOT made org-aware in this PR: the only inserter of
 * status='queued' rows is notificationService.sendNotification(), which is
 * template_id-driven and has no organizationId available at its INSERT site
 * (see src/services/notificationService.js's own comment). Wiring that
 * through would mean threading organizationId into every sendNotification()
 * call site first — a separate, larger change. Global transport only.
 */
async function processQueue() {
  const [queued] = await db.query(
    'SELECT * FROM email_logs WHERE status = \'queued\' ORDER BY created_at ASC LIMIT 50',
  );

  let sent = 0;
  let failed = 0;

  for (const entry of queued) {
    try {
      if (!transporter) init();

      const from = process.env.SMTP_FROM || 'noreply@fireisp.local';
      await transporter.sendMail({
        from,
        to: entry.recipient,
        subject: entry.subject,
        html: entry.body || undefined,
        text: entry.body || undefined,
      });

      await db.query(
        'UPDATE email_logs SET status = ?, sent_at = NOW() WHERE id = ?',
        ['sent', entry.id],
      );
      sent++;
    } catch (err) {
      await db.query(
        'UPDATE email_logs SET status = ?, error_message = ? WHERE id = ?',
        ['failed', err.message, entry.id],
      );
      failed++;
    }
  }

  return { sent, failed, total: queued.length };
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
