// =============================================================================
// FireISP 5.0 — Per-Organization, Per-Function Email (SMTP) Settings Service
// =============================================================================
// Thin service layer between the email-settings routes and
// src/models/EmailSettings.js. Since migration 407 an org holds one identity
// per function ('general' | 'support' | 'billing' | 'noc'); the function
// argument defaults to 'general' so the legacy /email-settings routes keep
// their exact single-identity behavior.
// =============================================================================

const EmailSettings = require('../models/EmailSettings');
const emailTransport = require('../services/emailTransport');
const { baseLayout } = require('../views/emailTemplates');
const { ValidationError } = require('../utils/errors');

const DEFAULT_FUNCTION = EmailSettings.DEFAULT_FUNCTION;

/** Throw a 422 unless `fn` is a known email function. */
function assertFunction(fn) {
  if (!EmailSettings.FUNCTIONS.includes(fn)) {
    throw new ValidationError(`Unknown email function: ${fn}. Expected one of ${EmailSettings.FUNCTIONS.join(', ')}.`);
  }
  return fn;
}

/** Every function's identity for an org (one entry per function). */
async function listEmailSettings(orgId) {
  return EmailSettings.listByOrgId(orgId);
}

async function getEmailSettings(orgId, emailFunction = DEFAULT_FUNCTION) {
  return EmailSettings.findByOrgId(orgId, assertFunction(emailFunction));
}

async function saveEmailSettings(orgId, emailFunction = DEFAULT_FUNCTION, payload) {
  return EmailSettings.upsert(orgId, assertFunction(emailFunction), payload || {});
}

/**
 * Send a fixed-content test email using the org's transport for the given
 * function (falling back function -> general -> global, the same resolution
 * every real send uses), then record the outcome on that function's settings
 * row. Returns {success, error} without ever throwing on a delivery failure —
 * the caller (route) returns this inline as 200 so the frontend can render
 * the result, not a raw 500.
 */
async function testEmailSettings(orgId, emailFunction, to) {
  const fn = assertFunction(emailFunction || DEFAULT_FUNCTION);
  const content = `
    <div class="header">
      <h1>Test Email</h1>
    </div>
    <p>This is a test message sent from your FireISP <strong>${fn}</strong> email settings.</p>
    <p class="meta">If you received this, your outbound email configuration for the ${fn} function is working correctly.</p>`;

  const result = await emailTransport.sendEmail({
    organizationId: orgId,
    emailFunction: fn,
    to,
    subject: `FireISP — Test Email (${fn})`,
    html: baseLayout(content),
    text: `This is a test message sent from your FireISP ${fn} email settings. If you received this, your outbound email configuration for the ${fn} function is working correctly.`,
  });

  await EmailSettings.recordTestResult(orgId, fn, {
    success: Boolean(result.success),
    error: result.error || null,
  });

  return result;
}

module.exports = { listEmailSettings, getEmailSettings, saveEmailSettings, testEmailSettings };
