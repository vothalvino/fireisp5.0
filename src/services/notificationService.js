// =============================================================================
// FireISP 5.0 — Notification Service
// =============================================================================
// Sends notifications (email, SMS, WhatsApp) and logs them.
// =============================================================================

const db = require('../config/database');

/**
 * Send a notification using a message template.
 */
async function sendNotification({ organizationId, clientId, channel, templateId, recipientEmail, recipientPhone, variables }) {
  // Load template if provided
  let subject = '', body = '';
  if (templateId) {
    const [templates] = await db.query(
      'SELECT * FROM message_templates WHERE id = ?',
      [templateId],
    );
    if (templates[0]) {
      subject = templates[0].subject || '';
      body = templates[0].body || '';
      // Replace template variables
      if (variables) {
        for (const [key, val] of Object.entries(variables)) {
          const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          subject = subject.replace(placeholder, val);
          body = body.replace(placeholder, val);
        }
      }
    }
  }

  if (channel === 'email') {
    // Log to email_logs (actual sending would use SMTP transport)
    await db.query(
      `INSERT INTO email_logs (organization_id, client_id, template_id, recipient, subject, body, channel, status)
       VALUES (?, ?, ?, ?, ?, ?, 'email', 'queued')`,
      [organizationId, clientId, templateId, recipientEmail, subject, body],
    );
  } else if (channel === 'sms' || channel === 'whatsapp') {
    // Log to sms_logs
    await db.query(
      `INSERT INTO sms_logs (organization_id, client_id, template_id, recipient, channel, body, direction, status)
       VALUES (?, ?, ?, ?, ?, ?, 'outbound', 'queued')`,
      [organizationId, clientId, templateId, recipientPhone, channel, body],
    );
  }

  // Create in-app notification
  await db.query(
    `INSERT INTO notifications (user_id, organization_id, title, body, type, status)
     VALUES (NULL, ?, ?, ?, 'billing', 'unread')`,
    [organizationId, subject, body],
  );

  return { subject, body, channel };
}

module.exports = { sendNotification };
