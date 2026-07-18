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
const db = require('../config/database');
const { decrypt } = require('../utils/encryption');

let transporter = null;

// "orgId:function" (String) -> { transporter, from } | null (null = "no
// config for this function or its general fallback, use global"). Mirrors
// src/config/database.js's tenantConfigCache Map-keyed pattern.
const orgTransportCache = new Map();

// Per-org generation counter, bumped by invalidateOrgTransport. A getOrgTransport
// call captures the generation before its DB read and refuses to cache the
// result if an invalidation raced in between — otherwise a save concurrent
// with an in-flight resolve could re-populate the cache with a stale transport
// that then persists until the NEXT save.
const orgCacheGen = new Map();

const DEFAULT_FUNCTION = 'general';

function cacheKey(orgId, emailFunction) {
  return `${orgId}:${emailFunction}`;
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
  if (orgTransportCache.has(key)) {
    return orgTransportCache.get(key);
  }

  // Snapshot the org's cache generation BEFORE the async read; if an
  // invalidation fires while we're resolving, we return the fresh value but
  // do not write it to the cache (a later call re-resolves cleanly).
  const genAtStart = orgCacheGen.get(organizationId) || 0;
  const cacheIfCurrent = (entry) => {
    if ((orgCacheGen.get(organizationId) || 0) === genAtStart) {
      orgTransportCache.set(key, entry);
    }
    return entry;
  };

  // Lazy require to avoid a require cycle (EmailSettings.upsert() requires
  // this module to invalidate the cache on save).
  const EmailSettings = require('../models/EmailSettings');
  const row = await EmailSettings.findRawByOrgId(organizationId, emailFunction);

  if (!row || !row.enabled || !row.smtp_host) {
    // This function isn't configured — inherit the org's 'general' identity
    // (unless we ARE resolving 'general', in which case fall through to
    // global). Cache the resolved value under this function's key.
    const entry = emailFunction === DEFAULT_FUNCTION
      ? null
      : await getOrgTransport(organizationId, DEFAULT_FUNCTION);
    return cacheIfCurrent(entry);
  }

  const orgTransporter = nodemailer.createTransport({
    host: row.smtp_host,
    port: row.smtp_port || 587,
    secure: Boolean(row.smtp_secure),
    auth: row.smtp_user ? {
      user: row.smtp_user,
      pass: decrypt(row.smtp_password_encrypted),
    } : undefined,
  });

  const from = row.from_name
    ? `${row.from_name} <${row.from_email || row.smtp_user}>`
    : (row.from_email || row.smtp_user);

  return cacheIfCurrent({ transporter: orgTransporter, from });
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
  for (const key of orgTransportCache.keys()) {
    if (key.startsWith(prefix)) orgTransportCache.delete(key);
  }
}

/**
 * Send a single email and log it to email_logs.
 */
async function sendEmail({ to, subject, html, text, attachments, organizationId, clientId, emailFunction = DEFAULT_FUNCTION }) {
  let activeTransporter = transporter;
  let from = process.env.SMTP_FROM || 'noreply@fireisp.local';

  if (organizationId) {
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
    const info = await activeTransporter.sendMail({ from, to, subject, html, text, attachments });

    await db.query(
      `INSERT INTO email_logs (recipient, subject, channel, status, sent_at, organization_id, client_id)
       VALUES (?, ?, 'email', 'sent', NOW(), ?, ?)`,
      [to, subject, organizationId || null, clientId || null],
    );

    return { success: true, messageId: info.messageId };
  } catch (err) {
    await db.query(
      `INSERT INTO email_logs (recipient, subject, channel, status, error_message, organization_id, client_id)
       VALUES (?, ?, 'email', 'failed', ?, ?, ?)`,
      [to, subject, err.message, organizationId || null, clientId || null],
    );

    return { success: false, error: err.message };
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

module.exports = { init, sendEmail, processQueue, getOrgTransport, invalidateOrgTransport };
