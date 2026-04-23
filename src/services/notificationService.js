// =============================================================================
// FireISP 5.0 — Notification Service
// =============================================================================
// Sends notifications (email, SMS, WhatsApp) and logs them.
// Supports Twilio for SMS and WhatsApp delivery.
// =============================================================================

const https = require('https');
const { URLSearchParams } = require('url');
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
    // Attempt to send via Twilio, fall back to queuing
    let status = 'queued';
    let providerMessageId = null;
    let errorMessage = null;

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        const result = await sendViaTwilio({
          to: recipientPhone,
          body,
          channel,
        });
        status = result.status === 'queued' || result.status === 'sent' ? 'sent' : 'failed';
        providerMessageId = result.sid || null;
      } catch (err) {
        status = 'failed';
        errorMessage = err.message;
      }
    }

    await db.query(
      `INSERT INTO sms_logs (organization_id, client_id, template_id, phone_number, channel, message_body, direction, status, provider_message_id, error_message)
       VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?, ?)`,
      [organizationId, clientId, templateId, recipientPhone, channel, body, status, providerMessageId, errorMessage],
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

/**
 * Send an SMS or WhatsApp message via Twilio REST API (no SDK — uses built-in https).
 */
async function sendViaTwilio({ to, body, channel }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = channel === 'whatsapp'
    ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM}`
    : process.env.TWILIO_FROM;
  const toNumber = channel === 'whatsapp' ? `whatsapp:${to}` : to;

  const postBody = new URLSearchParams({
    To: toNumber,
    From: fromNumber,
    Body: body,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(accountSid + ':' + authToken).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
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
            reject(new Error(parsed.message || `Twilio HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
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

module.exports = { sendNotification, sendViaTwilio };
