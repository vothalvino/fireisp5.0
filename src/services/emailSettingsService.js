// =============================================================================
// FireISP 5.0 — Per-Organization Email (SMTP) Settings Service
// =============================================================================
// Thin service layer between src/routes/emailSettings.js and
// src/models/EmailSettings.js — mirrors the shape of
// src/services/tenantDatabaseService.js (the closest existing analog: a
// one-row-per-org config with an encrypted secret, a save path, and a
// "test" path that performs a live round-trip and records the result).
// =============================================================================

const EmailSettings = require('../models/EmailSettings');
const emailTransport = require('../services/emailTransport');
const { baseLayout } = require('../views/emailTemplates');

async function getEmailSettings(orgId) {
  return EmailSettings.findByOrgId(orgId);
}

async function saveEmailSettings(orgId, payload) {
  return EmailSettings.upsert(orgId, payload || {});
}

/**
 * Send a fixed-content test email using the org's configured SMTP transport
 * (falling back to the global relay when the org has none/disabled — the
 * same fallback getOrgTransport() applies to every other send), then record
 * the outcome on the settings row. Returns {success, error} without ever
 * throwing on a delivery failure — the caller (route) returns this inline
 * as 200 so the frontend can render the result, not a raw 500.
 */
async function testEmailSettings(orgId, to) {
  const content = `
    <div class="header">
      <h1>Test Email</h1>
    </div>
    <p>This is a test message sent from your FireISP email settings.</p>
    <p class="meta">If you received this, your outbound email configuration is working correctly.</p>`;

  const result = await emailTransport.sendEmail({
    organizationId: orgId,
    to,
    subject: 'FireISP — Test Email',
    html: baseLayout(content),
    text: 'This is a test message sent from your FireISP email settings. If you received this, your outbound email configuration is working correctly.',
  });

  await EmailSettings.recordTestResult(orgId, {
    success: Boolean(result.success),
    error: result.error || null,
  });

  return result;
}

module.exports = { getEmailSettings, saveEmailSettings, testEmailSettings };
