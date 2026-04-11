// =============================================================================
// FireISP 5.0 — Email Transport Service
// =============================================================================
// Sends queued emails via SMTP using Nodemailer.
// =============================================================================

const nodemailer = require('nodemailer');
const db = require('../config/database');

let transporter = null;

/**
 * Initialize the transport (called once at boot).
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
 * Send a single email and log it to email_logs.
 */
async function sendEmail({ organizationId, to, subject, html, text }) {
  if (!transporter) init();

  const from = process.env.SMTP_FROM || 'noreply@fireisp.local';

  try {
    const info = await transporter.sendMail({ from, to, subject, html, text });

    await db.query(
      `INSERT INTO email_logs (organization_id, recipient, subject, channel, status, sent_at)
       VALUES (?, ?, ?, 'email', 'sent', NOW())`,
      [organizationId, to, subject],
    );

    return { success: true, messageId: info.messageId };
  } catch (err) {
    await db.query(
      `INSERT INTO email_logs (organization_id, recipient, subject, channel, status, error_message)
       VALUES (?, ?, ?, 'email', 'failed', ?)`,
      [organizationId, to, subject, err.message],
    );

    return { success: false, error: err.message };
  }
}

/**
 * Process all queued emails (status = 'queued' in email_logs).
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
        html: entry.body_html || undefined,
        text: entry.body_text || undefined,
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

module.exports = { init, sendEmail, processQueue };
