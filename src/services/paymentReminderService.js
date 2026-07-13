// =============================================================================
// FireISP 5.0 — Payment Reminder Service
// =============================================================================
// Sends transactional payment reminders (before/on/after due date) to clients
// based on configurable schedules stored in payment_reminder_settings.
// Uses payment_reminder_logs for idempotency (no duplicate sends).
// =============================================================================

const db = require('../config/database');
const emailTransport = require('./emailTransport');
const smsTransport = require('./smsTransport');
const logger = require('../utils/logger');
// invoice.client_name (below) is free-text DB data interpolated raw into the
// HTML reminder email — escape it (never applied to the parallel SMS body).
const { escapeHtmlForTemplate: esc } = require('./notificationService');

/**
 * Get reminder settings for an organization. Returns null if not configured.
 * @param {number} organizationId
 * @returns {Promise<object|null>}
 */
async function getReminderSettings(organizationId) {
  const [rows] = await db.query(
    'SELECT * FROM payment_reminder_settings WHERE organization_id = ?',
    [organizationId],
  );
  return rows[0] || null;
}

/**
 * Upsert reminder settings for an organization.
 * @param {number} organizationId
 * @param {object} data
 * @returns {Promise<object>}
 */
async function upsertReminderSettings(organizationId, data) {
  const { days_before_due, send_on_due, days_after_due, enabled } = data;

  await db.query(
    `INSERT INTO payment_reminder_settings
        (organization_id, days_before_due, send_on_due, days_after_due, enabled)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        days_before_due = VALUES(days_before_due),
        send_on_due     = VALUES(send_on_due),
        days_after_due  = VALUES(days_after_due),
        enabled         = VALUES(enabled),
        updated_at      = CURRENT_TIMESTAMP`,
    [
      organizationId,
      JSON.stringify(days_before_due || []),
      send_on_due !== undefined ? (send_on_due ? 1 : 0) : 1,
      JSON.stringify(days_after_due || []),
      enabled !== undefined ? (enabled ? 1 : 0) : 1,
    ],
  );

  return getReminderSettings(organizationId);
}

/**
 * Check whether a reminder has already been sent for a given stage + channel.
 * @param {number} invoiceId
 * @param {string} stage
 * @param {string} channel
 * @returns {Promise<boolean>}
 */
async function isAlreadySent(invoiceId, stage, channel) {
  const [rows] = await db.query(
    'SELECT id FROM payment_reminder_logs WHERE invoice_id = ? AND stage = ? AND channel = ?',
    [invoiceId, stage, channel],
  );
  return rows.length > 0;
}

/**
 * Record a sent reminder in the idempotency log.
 * @param {number} invoiceId
 * @param {number} organizationId
 * @param {string} stage
 * @param {string} channel
 */
async function logReminder(invoiceId, organizationId, stage, channel) {
  await db.query(
    `INSERT IGNORE INTO payment_reminder_logs (invoice_id, organization_id, stage, channel)
     VALUES (?, ?, ?, ?)`,
    [invoiceId, organizationId, stage, channel],
  );
}

/**
 * Determine which reminder stages should have fired for an invoice given its
 * due_date and the current date.
 *
 * @param {string} dueDateStr  ISO date string e.g. '2026-06-15'
 * @param {object} settings    payment_reminder_settings row
 * @returns {string[]}         stage names that should have been sent, e.g. ['before_7', 'on_due']
 */
function computeStagesToSend(dueDateStr, settings) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(dueDateStr);
  dueDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((dueDate - today) / 86400000); // positive = future, negative = past

  const stages = [];

  // Before due: diffDays > 0 means due is in the future
  const daysBefore = Array.isArray(settings.days_before_due) ? settings.days_before_due : [];
  for (const d of daysBefore) {
    if (diffDays <= d) {
      stages.push(`before_${d}`);
    }
  }

  // On due day
  if (settings.send_on_due && diffDays === 0) {
    stages.push('on_due');
  }

  // After due: diffDays < 0 means overdue
  const daysAfter = Array.isArray(settings.days_after_due) ? settings.days_after_due : [];
  for (const d of daysAfter) {
    if (-diffDays >= d) {
      stages.push(`after_${d}`);
    }
  }

  return stages;
}

/**
 * Send payment reminders for all eligible invoices in an organization.
 * Transactional messages — bypass DND checks intentionally (payment notices
 * are legally permissible even under DND).
 *
 * @param {number} organizationId
 * @returns {Promise<{ reminders_sent: number, invoices_checked: number }>}
 */
async function sendPaymentReminders(organizationId) {
  const settings = await getReminderSettings(organizationId);
  if (!settings || !settings.enabled) {
    return { reminders_sent: 0, invoices_checked: 0 };
  }

  // Parse JSON columns (MySQL driver may return them already parsed)
  if (typeof settings.days_before_due === 'string') {
    try { settings.days_before_due = JSON.parse(settings.days_before_due); } catch (_) { settings.days_before_due = []; }
  }
  if (typeof settings.days_after_due === 'string') {
    try { settings.days_after_due = JSON.parse(settings.days_after_due); } catch (_) { settings.days_after_due = []; }
  }

  // Find invoices with pending balances
  const [invoices] = await db.query(
    `SELECT i.id, i.invoice_number, i.total, i.currency, i.due_date, i.client_id,
            cl.name AS client_name,
            cl.email AS client_email, cl.phone AS client_phone
     FROM invoices i
     LEFT JOIN clients cl ON cl.id = i.client_id
     WHERE i.organization_id = ?
       AND i.status IN ('issued', 'overdue')
       AND i.deleted_at IS NULL`,
    [organizationId],
  );

  let remindersSent = 0;

  for (const invoice of invoices) {
    const stages = computeStagesToSend(invoice.due_date, settings);

    for (const stage of stages) {
      // Email channel
      if (invoice.client_email) {
        const alreadySent = await isAlreadySent(invoice.id, stage, 'email');
        if (!alreadySent) {
          try {
            const isOverdue = stage.startsWith('after_');
            const subject = isOverdue
              ? `Payment Overdue — Invoice ${invoice.invoice_number}`
              : `Payment Reminder — Invoice ${invoice.invoice_number}`;

            const dueStr = invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : 'N/A';
            const html = `<p>Dear ${esc(invoice.client_name || 'Client')},</p>`
              + `<p>This is a reminder that invoice <strong>${invoice.invoice_number}</strong> `
              + `for <strong>${invoice.currency} ${parseFloat(invoice.total).toFixed(2)}</strong> `
              + (isOverdue
                ? `is <strong>overdue</strong>. It was due on ${dueStr}. Please arrange payment at your earliest convenience.`
                : `is due on <strong>${dueStr}</strong>. Please ensure payment is made on time.`)
              + '</p>'
              + '<p>If you have already paid, please disregard this message.</p>';

            await emailTransport.sendEmail({
              organizationId,
              to: invoice.client_email,
              subject,
              html,
            });

            await logReminder(invoice.id, organizationId, stage, 'email');
            remindersSent++;
          } catch (err) {
            logger.error({ err, invoiceId: invoice.id, stage }, 'paymentReminderService: email send error');
          }
        }
      }

      // SMS channel
      if (invoice.client_phone) {
        const alreadySentSms = await isAlreadySent(invoice.id, stage, 'sms');
        if (!alreadySentSms) {
          try {
            const dueStr = invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : 'N/A';
            const isOverdue = stage.startsWith('after_');
            const body = isOverdue
              ? `Invoice ${invoice.invoice_number} (${invoice.currency} ${parseFloat(invoice.total).toFixed(2)}) is OVERDUE since ${dueStr}. Please pay now.`
              : `Reminder: Invoice ${invoice.invoice_number} (${invoice.currency} ${parseFloat(invoice.total).toFixed(2)}) is due ${dueStr}.`;

            await smsTransport.queueSms({
              organizationId,
              clientId: invoice.client_id,
              to: invoice.client_phone,
              body,
            });

            await logReminder(invoice.id, organizationId, stage, 'sms');
            remindersSent++;
          } catch (err) {
            logger.error({ err, invoiceId: invoice.id, stage }, 'paymentReminderService: SMS send error');
          }
        }
      }
    }
  }

  return { reminders_sent: remindersSent, invoices_checked: invoices.length };
}

module.exports = {
  getReminderSettings,
  upsertReminderSettings,
  sendPaymentReminders,
};
