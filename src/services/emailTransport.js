// =============================================================================
// FireISP 5.0 — Email Transport Service
// =============================================================================
// SMTP transport using Nodemailer. Sends emails and updates delivery status
// in the email_logs table.
// =============================================================================

const nodemailer = require('nodemailer');
const db = require('../config/database');

let transporter = null;

/**
 * Get or create the SMTP transporter using environment variables.
 * Returns null if SMTP is not configured.
 */
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) return null;

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });

  return transporter;
}

/**
 * Send an email using the configured SMTP transport.
 * Updates the email_logs row status from 'queued' to 'sent' or 'failed'.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email address
 * @param {string} params.subject - Email subject
 * @param {string} params.body - Email body (HTML or plain text)
 * @param {number} [params.emailLogId] - email_logs row ID to update status
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail({ to, subject, body, emailLogId }) {
  const smtp = getTransporter();

  if (!smtp) {
    // SMTP not configured — leave as queued for future delivery
    return { success: false, error: 'SMTP not configured' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@fireisp.local';

  try {
    const info = await smtp.sendMail({
      from,
      to,
      subject,
      html: body,
    });

    if (emailLogId) {
      await db.query(
        'UPDATE email_logs SET status = ?, sent_at = NOW() WHERE id = ?',
        ['sent', emailLogId],
      );
    }

    return { success: true, messageId: info.messageId };
  } catch (err) {
    if (emailLogId) {
      await db.query(
        'UPDATE email_logs SET status = ?, error_message = ? WHERE id = ?',
        ['failed', err.message, emailLogId],
      );
    }

    return { success: false, error: err.message };
  }
}

/**
 * Process all queued email_logs entries and attempt delivery.
 * Called by the scheduler or manually.
 */
async function processQueue(limit = 50) {
  const [queued] = await db.query(
    'SELECT * FROM email_logs WHERE status = ? ORDER BY created_at ASC LIMIT ?',
    ['queued', limit],
  );

  let sent = 0;
  let failed = 0;

  for (const entry of queued) {
    const result = await sendEmail({
      to: entry.recipient,
      subject: entry.subject,
      body: entry.body,
      emailLogId: entry.id,
    });

    if (result.success) sent++;
    else failed++;
  }

  return { sent, failed, total: queued.length };
}

/**
 * Verify SMTP connection is working.
 */
async function verify() {
  const smtp = getTransporter();
  if (!smtp) return { configured: false };

  try {
    await smtp.verify();
    return { configured: true, connected: true };
  } catch (err) {
    return { configured: true, connected: false, error: err.message };
  }
}

/**
 * Close the SMTP transporter (for graceful shutdown).
 */
function close() {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
}

module.exports = { sendEmail, processQueue, verify, close, getTransporter };
