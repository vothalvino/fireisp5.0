// =============================================================================
// FireISP 5.0 — Notification Service
// =============================================================================
// Sends notifications (email, SMS, WhatsApp) and logs them.
// Supports Twilio for SMS and WhatsApp delivery.
// =============================================================================

const db = require('../config/database');
const emailTransport = require('./emailTransport');
const smsTransport = require('./smsTransport');

/**
 * HTML-escape a value for interpolation into an HTML email body/subject.
 * Shared across every HTML-email sink in the codebase (see the callers
 * below plus src/views/emailTemplates.js, src/services/notificationHooks.js,
 * paymentReminderService.js, scheduledReportService.js, and
 * campaignService.js's merge-field substitution) — this is the ONE escaping
 * helper for that purpose; do not duplicate it. NOT applied to sms/whatsapp
 * bodies, which are plain text — escaping there would corrupt the message
 * the subscriber actually reads (literal "&amp;"). Mirrors
 * cfdiService.escapeXml's output-encoding pattern for CFDI XML.
 *
 * null/undefined become '' rather than the literal strings "null"/
 * "undefined" (String(val) alone would emit those); numbers and other
 * primitives pass through String()'s normal coercion unaffected.
 */
function escapeHtmlForTemplate(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Send a notification using a message template.
 */
async function sendNotification({
  organizationId,
  clientId,
  channel,
  templateId,
  recipientEmail,
  recipientPhone,
  variables,
  messageClass,
}) {
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
          const substituted = channel === 'email' ? escapeHtmlForTemplate(val) : val;
          subject = subject.replace(placeholder, substituted);
          body = body.replace(placeholder, substituted);
        }
      }
    }
  }

  if (channel === 'email') {
    await emailTransport.sendEmail({
      organizationId,
      clientId,
      messageClass,
      to: recipientEmail,
      subject,
      html: body,
      text: body,
    });
  } else if (channel === 'sms' || channel === 'whatsapp') {
    await smsTransport.queueSms({
      organizationId,
      clientId,
      messageClass,
      templateId,
      to: recipientPhone,
      body,
      channel,
    });
  }

  // In-app notifications are STAFF-facing: `notifications.user_id` is NOT NULL and
  // the table has neither an `organization_id` nor a `status` column
  // (database/schema.sql). This function notifies a *client* over email/SMS —
  // there is no staff recipient to address — so it no longer writes a row that
  // could never be inserted. Delivery is already recorded in email_logs/sms_logs;
  // per-user in-app notifications are created by the callers that have a user id.
  return { subject, body, channel };
}

module.exports = { sendNotification, escapeHtmlForTemplate };
