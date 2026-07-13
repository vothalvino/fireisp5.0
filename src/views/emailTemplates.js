// =============================================================================
// FireISP 5.0 — Email Templates
// =============================================================================
// HTML email template builders for transactional emails.
// Each function returns { subject, html } ready for nodemailer.
// Variables use {{placeholder}} syntax matching message_templates table.
// =============================================================================

const { escapeHtml } = require('../utils/htmlEscape');

/**
 * Base HTML wrapper shared by all templates.
 */
function baseLayout(content, footerText) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FireISP</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f6f9; color: #2c3e50; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: #ffffff; border-radius: 8px; padding: 32px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .header { text-align: center; padding-bottom: 24px; border-bottom: 2px solid #ecf0f1; margin-bottom: 24px; }
    .header h1 { margin: 0; color: #1a5276; font-size: 22px; }
    .header .subtitle { color: #7f8c8d; font-size: 13px; margin-top: 4px; }
    .btn { display: inline-block; padding: 12px 28px; background-color: #2980b9; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; }
    .btn:hover { background-color: #1a5276; }
    .btn-danger { background-color: #c0392b; }
    .footer { text-align: center; padding-top: 16px; color: #95a5a6; font-size: 11px; }
    .table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .table th { text-align: left; padding: 8px; border-bottom: 2px solid #ecf0f1; color: #7f8c8d; font-size: 12px; text-transform: uppercase; }
    .table td { padding: 8px; border-bottom: 1px solid #f4f6f9; font-size: 13px; }
    .amount { font-size: 28px; font-weight: 700; color: #1a5276; text-align: center; margin: 16px 0; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge-success { background: #d5f5e3; color: #27ae60; }
    .badge-warning { background: #fdebd0; color: #e67e22; }
    .badge-danger { background: #fadbd8; color: #c0392b; }
    .meta { color: #7f8c8d; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      ${content}
    </div>
    <div class="footer">
      ${footerText || 'Powered by FireISP 5.0'}
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Welcome / Registration
// ---------------------------------------------------------------------------

function welcomeEmail(vars) {
  const { portalUrl } = vars;
  // clientName/orgName are DB free text (clients.name / organizations.name) —
  // escape before interpolating into HTML. Subject lines below intentionally
  // use the RAW vars.* values: a subject header is plain text, never rendered
  // as HTML, so escaping it would show literal "&amp;" etc. to the recipient.
  const clientName = escapeHtml(vars.clientName || 'Valued Customer');
  const orgName = escapeHtml(vars.orgName || 'FireISP');
  const content = `
    <div class="header">
      <h1>Welcome to ${orgName}</h1>
      <div class="subtitle">Your internet service account is ready</div>
    </div>
    <p>Hello <strong>${clientName}</strong>,</p>
    <p>Thank you for choosing ${orgName}! Your account has been created and is ready to use.</p>
    <p>You can access your account portal to view invoices, make payments, and manage your service:</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl || '#'}" class="btn">Access Your Account</a>
    </p>
    <p>If you have any questions, feel free to contact our support team.</p>
    <p class="meta">Best regards,<br>${orgName} Team</p>`;

  return {
    subject: `Welcome to ${vars.orgName || 'FireISP'} — Account Created`,
    html: baseLayout(content),
  };
}

// ---------------------------------------------------------------------------
// Invoice Notification
// ---------------------------------------------------------------------------

function invoiceEmail(vars) {
  const { total, currency, dueDate, portalUrl, items } = vars;
  // clientName/orgName, each line item's description, AND invoiceNumber are
  // all DB free text — invoices.invoice_number is a plain VARCHAR(50) that
  // POST /invoices accepts as arbitrary user input (src/middleware/schemas/
  // invoices.js only bounds its length, no format/charset constraint), NOT a
  // guaranteed system-generated sequence value. Escape all four.
  // total/currency/dueDate ARE genuinely safe as-is: total is numeric
  // (parseFloat'd below), dueDate is a formatted date string built by the
  // caller, and currency is a config/UI-selected ISO 4217 code, never
  // free-form user text.
  const clientName = escapeHtml(vars.clientName || 'Customer');
  const orgName = escapeHtml(vars.orgName || 'FireISP');
  const invoiceNumber = vars.invoiceNumber ? escapeHtml(vars.invoiceNumber) : '';
  const itemsHtml = (items || []).map(i =>
    `<tr><td>${escapeHtml(i.description || '')}</td><td style="text-align:right">${currency || 'USD'} ${parseFloat(i.amount || 0).toFixed(2)}</td></tr>`,
  ).join('');

  const content = `
    <div class="header">
      <h1>New Invoice</h1>
      <div class="subtitle">${invoiceNumber}</div>
    </div>
    <p>Hello <strong>${clientName}</strong>,</p>
    <p>A new invoice has been generated for your account:</p>
    <div class="amount">${currency || 'USD'} ${parseFloat(total || 0).toFixed(2)}</div>
    ${itemsHtml ? `<table class="table"><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>${itemsHtml}</tbody></table>` : ''}
    <p><strong>Due Date:</strong> ${dueDate || 'N/A'}</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl || '#'}" class="btn">Pay Now</a>
    </p>
    <p class="meta">${orgName}</p>`;

  return {
    // Subject is plain text, never rendered as HTML — uses the RAW
    // vars.invoiceNumber, not the escaped local above (escaping it here
    // would show literal "&lt;...&gt;" to the recipient in their inbox
    // subject line instead of protecting against anything).
    subject: `Invoice ${vars.invoiceNumber || ''} — ${currency || 'USD'} ${parseFloat(total || 0).toFixed(2)} Due ${dueDate || ''}`,
    html: baseLayout(content),
  };
}

// ---------------------------------------------------------------------------
// Payment Receipt
// ---------------------------------------------------------------------------

function paymentReceiptEmail(vars) {
  const { amount, currency, paymentMethod, paymentDate } = vars;
  // clientName/orgName, reference (a manually-entered check/transaction
  // reference or gateway-supplied string), AND invoiceNumber (invoices.
  // invoice_number — free VARCHAR(50), not guaranteed system-generated, see
  // invoiceEmail() above for the full reasoning) are all DB free text —
  // escape all four. paymentMethod IS a genuine DB ENUM column (cash/card/
  // oxxo/spei/codi/...); amount/currency/paymentDate are numeric/formatted/
  // config-selected — those three stay raw.
  const clientName = escapeHtml(vars.clientName || 'Customer');
  const orgName = escapeHtml(vars.orgName || 'FireISP');
  const reference = vars.reference ? escapeHtml(vars.reference) : '';
  const invoiceNumber = vars.invoiceNumber ? escapeHtml(vars.invoiceNumber) : '';
  const content = `
    <div class="header">
      <h1>Payment Received</h1>
      <div class="subtitle"><span class="badge badge-success">Confirmed</span></div>
    </div>
    <p>Hello <strong>${clientName}</strong>,</p>
    <p>We have received your payment. Here are the details:</p>
    <div class="amount">${currency || 'USD'} ${parseFloat(amount || 0).toFixed(2)}</div>
    <table class="table">
      <tbody>
        <tr><td><strong>Date</strong></td><td>${paymentDate || new Date().toISOString().slice(0, 10)}</td></tr>
        <tr><td><strong>Method</strong></td><td>${paymentMethod || 'N/A'}</td></tr>
        ${reference ? `<tr><td><strong>Reference</strong></td><td>${reference}</td></tr>` : ''}
        ${invoiceNumber ? `<tr><td><strong>Invoice</strong></td><td>${invoiceNumber}</td></tr>` : ''}
      </tbody>
    </table>
    <p>Thank you for your payment!</p>
    <p class="meta">${orgName}</p>`;

  return {
    subject: `Payment Confirmed — ${currency || 'USD'} ${parseFloat(amount || 0).toFixed(2)}`,
    html: baseLayout(content),
  };
}

// ---------------------------------------------------------------------------
// Password Reset
// ---------------------------------------------------------------------------

function passwordResetEmail(vars) {
  const { resetUrl, expiresIn } = vars;
  // userName is user-controlled (first_name/last_name at signup) — escape it
  // before interpolating into HTML. Do NOT rely on upstream request-body
  // sanitization here: it is being removed in a separate PR, so this is the
  // only escaping this value gets before it lands in an email client's DOM.
  const userName = escapeHtml(String(vars.userName || 'User'));
  const content = `
    <div class="header">
      <h1>Password Reset</h1>
    </div>
    <p>Hello <strong>${userName}</strong>,</p>
    <p>We received a request to reset your password. Click the button below to set a new password:</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${resetUrl || '#'}" class="btn">Reset Password</a>
    </p>
    <p class="meta">This link expires in ${expiresIn || '1 hour'}. If you did not request a password reset, you can safely ignore this email.</p>`;

  return {
    subject: 'Password Reset Request',
    html: baseLayout(content),
  };
}

// ---------------------------------------------------------------------------
// Email Verification
// ---------------------------------------------------------------------------

function emailVerificationEmail(vars) {
  const { verifyUrl } = vars;
  // See passwordResetEmail() above — userName is user-controlled and must be
  // escaped at the point it enters the HTML, independent of upstream sanitization.
  const userName = escapeHtml(String(vars.userName || 'User'));
  const content = `
    <div class="header">
      <h1>Verify Your Email</h1>
    </div>
    <p>Hello <strong>${userName}</strong>,</p>
    <p>Please verify your email address by clicking the button below:</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${verifyUrl || '#'}" class="btn">Verify Email</a>
    </p>
    <p class="meta">If you did not create an account, you can safely ignore this email.</p>`;

  return {
    subject: 'Verify Your Email Address',
    html: baseLayout(content),
  };
}

// ---------------------------------------------------------------------------
// Suspension Warning
// ---------------------------------------------------------------------------

function suspensionWarningEmail(vars) {
  const { daysOverdue, total, currency, dueDate, portalUrl } = vars;
  // clientName/orgName/invoiceNumber are all DB free text — see invoiceEmail()
  // above for why invoiceNumber specifically is NOT safe to leave raw despite
  // looking like a system-generated sequence value.
  const clientName = escapeHtml(vars.clientName || 'Customer');
  const orgName = escapeHtml(vars.orgName || 'FireISP');
  const invoiceNumber = vars.invoiceNumber ? escapeHtml(vars.invoiceNumber) : '';
  const content = `
    <div class="header">
      <h1>Service Suspension Warning</h1>
      <div class="subtitle"><span class="badge badge-danger">Action Required</span></div>
    </div>
    <p>Hello <strong>${clientName}</strong>,</p>
    <p>Your account has an overdue balance. Your service may be suspended if payment is not received.</p>
    <table class="table">
      <tbody>
        <tr><td><strong>Invoice</strong></td><td>${invoiceNumber || 'N/A'}</td></tr>
        <tr><td><strong>Amount Due</strong></td><td>${currency || 'USD'} ${parseFloat(total || 0).toFixed(2)}</td></tr>
        <tr><td><strong>Due Date</strong></td><td>${dueDate || 'N/A'}</td></tr>
        <tr><td><strong>Days Overdue</strong></td><td><span class="badge badge-danger">${daysOverdue || 0} days</span></td></tr>
      </tbody>
    </table>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl || '#'}" class="btn btn-danger">Pay Now to Avoid Suspension</a>
    </p>
    <p class="meta">If you have already made a payment, please disregard this notice. Payments may take up to 24 hours to process.<br>${orgName}</p>`;

  return {
    // Subject is plain text — RAW vars.invoiceNumber, same reasoning as
    // invoiceEmail()'s subject above.
    subject: `⚠ Service Suspension Warning — Invoice ${vars.invoiceNumber || ''} Overdue`,
    html: baseLayout(content),
  };
}

// ---------------------------------------------------------------------------
// Service Suspended
// ---------------------------------------------------------------------------

function serviceSuspendedEmail(vars) {
  const { contractId, total, currency, portalUrl } = vars;
  const clientName = escapeHtml(vars.clientName || 'Customer');
  const orgName = escapeHtml(vars.orgName || 'FireISP');
  const content = `
    <div class="header">
      <h1>Service Suspended</h1>
      <div class="subtitle"><span class="badge badge-danger">Suspended</span></div>
    </div>
    <p>Hello <strong>${clientName}</strong>,</p>
    <p>Your internet service (contract #${contractId || ''}) has been suspended due to non-payment.</p>
    <p>Outstanding balance: <strong>${currency || 'USD'} ${parseFloat(total || 0).toFixed(2)}</strong></p>
    <p>To restore your service, please make a payment as soon as possible:</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl || '#'}" class="btn btn-danger">Pay & Restore Service</a>
    </p>
    <p class="meta">${orgName}</p>`;

  return {
    subject: 'Your Internet Service Has Been Suspended',
    html: baseLayout(content),
  };
}

// ---------------------------------------------------------------------------
// Outage Notification
// ---------------------------------------------------------------------------

function outageNotificationEmail(vars) {
  const { severity, startTime, estimatedRestore } = vars;
  // clientName/orgName/outageTitle/affectedArea are DB free text — escape.
  // severity is left as-is: it's an ENUM column ('info'|'warning'|'major'|
  // 'critical'), a closed vocabulary enforced at the DB layer, not free text,
  // and it's only ever compared/uppercased here, never used to build markup.
  const clientName = escapeHtml(vars.clientName || 'Customer');
  const orgName = escapeHtml(vars.orgName || 'FireISP');
  const outageTitle = escapeHtml(vars.outageTitle || 'Service Disruption');
  const affectedArea = vars.affectedArea ? escapeHtml(vars.affectedArea) : '';
  const severityBadge = severity === 'critical' ? 'badge-danger' : severity === 'major' ? 'badge-warning' : 'badge-success';
  const content = `
    <div class="header">
      <h1>Service Outage Notice</h1>
      <div class="subtitle"><span class="badge ${severityBadge}">${(severity || 'info').toUpperCase()}</span></div>
    </div>
    <p>Hello <strong>${clientName}</strong>,</p>
    <p>We are experiencing a service disruption that may affect your connection.</p>
    <table class="table">
      <tbody>
        <tr><td><strong>Issue</strong></td><td>${outageTitle}</td></tr>
        <tr><td><strong>Started</strong></td><td>${startTime || 'N/A'}</td></tr>
        ${estimatedRestore ? `<tr><td><strong>Est. Restoration</strong></td><td>${estimatedRestore}</td></tr>` : ''}
        ${affectedArea ? `<tr><td><strong>Affected Area</strong></td><td>${affectedArea}</td></tr>` : ''}
      </tbody>
    </table>
    <p>Our team is working to resolve this as quickly as possible. We apologize for any inconvenience.</p>
    <p class="meta">${orgName}</p>`;

  return {
    subject: `Service Outage: ${vars.outageTitle || 'Disruption'} — ${vars.orgName || 'FireISP'}`,
    html: baseLayout(content),
  };
}

module.exports = {
  baseLayout,
  welcomeEmail,
  invoiceEmail,
  paymentReceiptEmail,
  passwordResetEmail,
  emailVerificationEmail,
  suspensionWarningEmail,
  serviceSuspendedEmail,
  outageNotificationEmail,
};
